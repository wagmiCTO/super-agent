package strategy

import (
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
)

// RSI is the counter-trend signal: Wilder's relative strength index over
// closed bars. When a bar closes with the index entering the oversold zone
// the crowd has sold too hard and the screen offers an entry up; entering
// the overbought zone offers an entry down. It is the trend strategy's
// opposite, on purpose: the two argue every week.
type RSI struct {
	cfg RSIConfig

	mu      sync.Mutex
	bars    []venue.Candle // closed, ascending
	forming *venue.Candle
	values  []fixed.D // RSI per bar; zero while warming up
	avgGain fixed.D
	avgLoss fixed.D
	last    *RSICross
}

// RSIConfig sizes the index, the zones and the window.
type RSIConfig struct {
	Symbol string
	Period time.Duration
	Length int
	// Oversold and Overbought are the zone edges, 0..100.
	Oversold, Overbought fixed.D
	Window               time.Duration
	History              int
}

// DefaultRSI ships with RSI(14) on one-minute bars, zones at 30 and 70, a
// three-minute window.
func DefaultRSI(symbol string) RSIConfig {
	return RSIConfig{Symbol: symbol, Period: time.Minute, Length: 14, Oversold: fixed.FromInt(30), Overbought: fixed.FromInt(70), Window: 3 * time.Minute, History: 120}
}

func (c RSIConfig) validate() error {
	switch {
	case c.Symbol == "":
		return errors.New("strategy: rsi needs a symbol")
	case c.Period <= 0:
		return errors.New("strategy: rsi needs a bar period")
	case c.Length < 2:
		return fmt.Errorf("strategy: rsi length must be >= 2, got %d", c.Length)
	case !c.Oversold.IsPos() || c.Overbought.Cmp(c.Oversold) <= 0 || c.Overbought.Cmp(fixed.FromInt(100)) >= 0:
		return errors.New("strategy: rsi zones must satisfy 0 < oversold < overbought < 100")
	case c.Window <= 0:
		return errors.New("strategy: rsi needs a window")
	case c.History < c.Length+2:
		return fmt.Errorf("strategy: rsi history %d cannot hold length %d plus two", c.History, c.Length)
	}
	return nil
}

// RSICross is one entry into a zone.
type RSICross struct {
	Side  venue.Side // Long on entering oversold, Short on entering overbought
	At    time.Time
	Value fixed.D
}

// RSIPoint is one bar's close with the index as of that bar.
type RSIPoint struct {
	At    time.Time
	Close fixed.D
	Value fixed.D // zero while warming up
}

// RSIState is what the screen renders: the thermometer and the invitation.
type RSIState struct {
	Symbol               string
	Period               time.Duration
	Length               int
	Oversold, Overbought fixed.D
	Value                fixed.D // as of the last closed bar
	Points               []RSIPoint
	Forming              bool
	Window               *Window
	LastCross            *RSICross
	Ready                bool
}

func NewRSI(cfg RSIConfig) (*RSI, error) {
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return &RSI{cfg: cfg}, nil
}

// Seed loads closed history and replays the index over it.
func (r *RSI) Seed(bars []venue.Candle, now time.Time) {
	sorted := append([]venue.Candle(nil), bars...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Open.Before(sorted[j].Open) })
	r.mu.Lock()
	defer r.mu.Unlock()
	r.bars, r.values, r.forming, r.last = nil, nil, nil, nil
	r.avgGain, r.avgLoss = 0, 0
	for _, b := range sorted {
		if !b.Closed(now) {
			f := b
			r.forming = &f
			continue
		}
		if n := len(r.bars); n > 0 && !r.bars[n-1].Open.Before(b.Open) {
			continue
		}
		r.appendLocked(b)
	}
}

// Apply feeds one bar from the live stream.
func (r *RSI) Apply(b venue.Candle, now time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !b.Closed(now) {
		f := b
		r.forming = &f
		return
	}
	if n := len(r.bars); n > 0 && !r.bars[n-1].Open.Before(b.Open) {
		return
	}
	r.appendLocked(b)
	if r.forming != nil && !r.forming.Open.After(b.Open) {
		r.forming = nil
	}
}

// appendLocked adds a closed bar, extends the index (Wilder's smoothing:
// the first average is a simple mean over Length changes, then each new
// change is blended in with weight 1/Length) and checks for a zone entry.
func (r *RSI) appendLocked(b venue.Candle) {
	r.bars = append(r.bars, b)
	n := len(r.bars)
	var value fixed.D
	switch {
	case n <= r.cfg.Length:
		// warming up: no index yet
	case n == r.cfg.Length+1:
		var gain, loss fixed.D
		for i := 1; i < n; i++ {
			d := r.bars[i].C.Sub(r.bars[i-1].C)
			if d.IsPos() {
				gain = gain.Add(d)
			} else {
				loss = loss.Add(d.Neg())
			}
		}
		l := fixed.FromInt(int64(r.cfg.Length))
		r.avgGain, r.avgLoss = gain.Div(l), loss.Div(l)
		value = rsiOf(r.avgGain, r.avgLoss)
	default:
		d := r.bars[n-1].C.Sub(r.bars[n-2].C)
		var gain, loss fixed.D
		if d.IsPos() {
			gain = d
		} else {
			loss = d.Neg()
		}
		l := fixed.FromInt(int64(r.cfg.Length))
		one := fixed.FromInt(1)
		r.avgGain = r.avgGain.Mul(l.Sub(one)).Add(gain).Div(l)
		r.avgLoss = r.avgLoss.Mul(l.Sub(one)).Add(loss).Div(l)
		value = rsiOf(r.avgGain, r.avgLoss)
	}
	r.values = append(r.values, value)
	if n > r.cfg.Length+1 {
		prev := r.values[n-2]
		at := b.Open.Add(r.cfg.Period)
		switch {
		case prev.Cmp(r.cfg.Oversold) > 0 && value.Cmp(r.cfg.Oversold) <= 0:
			r.last = &RSICross{Side: venue.Long, At: at, Value: value}
		case prev.Cmp(r.cfg.Overbought) < 0 && value.Cmp(r.cfg.Overbought) >= 0:
			r.last = &RSICross{Side: venue.Short, At: at, Value: value}
		}
	}
	if extra := len(r.bars) - r.cfg.History; extra > 0 {
		r.bars = append(r.bars[:0], r.bars[extra:]...)
		r.values = append(r.values[:0], r.values[extra:]...)
	}
}

// rsiOf is 100 - 100/(1+RS); with no losses it is 100, with no gains 0.
func rsiOf(avgGain, avgLoss fixed.D) fixed.D {
	hundred := fixed.FromInt(100)
	switch {
	case avgLoss.IsZero() && avgGain.IsZero():
		return fixed.FromInt(50)
	case avgLoss.IsZero():
		return hundred
	}
	rs := avgGain.Div(avgLoss)
	return hundred.Sub(hundred.Div(fixed.FromInt(1).Add(rs)))
}

// State renders the signal as of now.
func (r *RSI) State(now time.Time) RSIState {
	r.mu.Lock()
	defer r.mu.Unlock()
	st := RSIState{Symbol: r.cfg.Symbol, Period: r.cfg.Period, Length: r.cfg.Length, Oversold: r.cfg.Oversold, Overbought: r.cfg.Overbought, Ready: len(r.bars) > r.cfg.Length}
	st.Points = make([]RSIPoint, 0, len(r.bars)+1)
	for i, b := range r.bars {
		st.Points = append(st.Points, RSIPoint{At: b.Open, Close: b.C, Value: r.values[i]})
	}
	if n := len(r.values); n > 0 {
		st.Value = r.values[n-1]
	}
	if r.forming != nil {
		st.Points = append(st.Points, RSIPoint{At: r.forming.Open, Close: r.forming.C})
		st.Forming = true
	}
	if r.last != nil {
		c := *r.last
		st.LastCross = &c
		if exp := c.At.Add(r.cfg.Window); now.Before(exp) {
			st.Window = &Window{Side: c.Side, OpenedAt: c.At, ExpiresAt: exp}
		}
	}
	return st
}
