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

// Donchian is the breakout signal the Turtles traded: the channel between
// the highest high and the lowest low of the last Length closed bars. A bar
// that closes above the channel — above every high of the Length bars before
// it — opens a window up; a close below every low opens one down. The
// channel is redrawn after every bar, so a strong trend breaks out again and
// again and a range never does.
//
// Only closed bars count, as with every signal here: a wick through the
// channel that closes back inside it is the market testing the edge, not
// leaving it.
type Donchian struct {
	cfg DonchianConfig

	mu      sync.Mutex
	bars    []venue.Candle // closed, ascending by open time
	forming *venue.Candle
	last    *Break
}

// DonchianConfig sizes the channel and the window.
type DonchianConfig struct {
	Symbol string
	Period time.Duration
	// Length is how many closed bars the channel spans.
	Length int
	// Window is how long after a breakout the entry stays offered.
	Window time.Duration
	// History is how many closed bars to keep for the chart and the channel.
	History int
}

// DefaultDonchian ships with the Turtles' entry channel: twenty bars, on
// one-minute bars, a three-minute window.
func DefaultDonchian(symbol string) DonchianConfig {
	return DonchianConfig{Symbol: symbol, Period: time.Minute, Length: 20, Window: 3 * time.Minute, History: 120}
}

func (c DonchianConfig) validate() error {
	switch {
	case c.Symbol == "":
		return errors.New("strategy: donchian needs a symbol")
	case c.Period <= 0:
		return errors.New("strategy: donchian needs a bar period")
	case c.Length < 2:
		return fmt.Errorf("strategy: donchian length must be >= 2, got %d", c.Length)
	case c.Window <= 0:
		return errors.New("strategy: donchian needs a window")
	case c.History < c.Length+1:
		return fmt.Errorf("strategy: donchian history %d cannot hold length %d plus one", c.History, c.Length)
	}
	return nil
}

// Break is one close outside a channel or a range.
type Break struct {
	// Side is the direction of the breakout: Long for a close above.
	Side venue.Side
	// At is when the bar that broke out closed.
	At time.Time
	// Price is that bar's close; Level is the edge it closed beyond.
	Price fixed.D
	Level fixed.D
}

// DonchianPoint is one bar with the channel it had to break: the highest
// high and lowest low of the Length bars before it. Zero while warming up.
type DonchianPoint struct {
	At              time.Time
	Open, High, Low fixed.D
	Close           fixed.D
	Upper, Lower    fixed.D
}

// DonchianState is what the screen renders: the bars, the channel the next
// bar has to break, and the invitation.
type DonchianState struct {
	Symbol string
	Period time.Duration
	Length int
	// Upper and Lower are the channel as of the last closed bar: what the
	// bar now forming has to close beyond. Zero until Ready.
	Upper, Lower fixed.D
	// Points are the closed bars, oldest first, then the forming bar when
	// there is one (Forming reports whether the last point is it).
	Points  []DonchianPoint
	Forming bool
	// Window is set while a breakout's entry is still offered.
	Window *Window
	// LastBreak is the most recent breakout, offered or not.
	LastBreak *Break
	// Ready is false until Length closed bars exist: a channel to break.
	Ready bool
}

// NewDonchian returns an empty signal; Seed it with history before feeding
// live bars, or the first breakouts will be missed.
func NewDonchian(cfg DonchianConfig) (*Donchian, error) {
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return &Donchian{cfg: cfg}, nil
}

// Seed loads closed history and replays it for the last breakout. A
// breakout inside the last Window is still an invitation.
func (d *Donchian) Seed(bars []venue.Candle, now time.Time) {
	sorted := append([]venue.Candle(nil), bars...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Open.Before(sorted[j].Open) })

	d.mu.Lock()
	defer d.mu.Unlock()
	d.bars, d.forming, d.last = d.bars[:0], nil, nil
	for _, b := range sorted {
		if !b.Closed(now) {
			f := b
			d.forming = &f
			continue
		}
		if n := len(d.bars); n > 0 && !d.bars[n-1].Open.Before(b.Open) {
			continue
		}
		d.bars = append(d.bars, b)
	}
	d.trimLocked()
	for i := d.cfg.Length; i < len(d.bars); i++ {
		if br, ok := d.breakAt(i); ok {
			d.last = &br
		}
	}
}

// Apply feeds one bar from the live stream. A bar for an open time already
// closed is ignored; the forming bar is replaced; a bar that just closed is
// appended and checked for a breakout.
func (d *Donchian) Apply(b venue.Candle, now time.Time) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if !b.Closed(now) {
		f := b
		d.forming = &f
		return
	}
	if n := len(d.bars); n > 0 && !d.bars[n-1].Open.Before(b.Open) {
		return
	}
	d.bars = append(d.bars, b)
	if d.forming != nil && !d.forming.Open.After(b.Open) {
		d.forming = nil
	}
	d.trimLocked()
	if br, ok := d.breakAt(len(d.bars) - 1); ok {
		d.last = &br
	}
}

func (d *Donchian) trimLocked() {
	if extra := len(d.bars) - d.cfg.History; extra > 0 {
		d.bars = append(d.bars[:0], d.bars[extra:]...)
	}
}

// channelBefore is the highest high and lowest low of the Length bars
// before index i; ok is false while there are not that many. Callers hold
// d.mu.
func (d *Donchian) channelBefore(i int) (upper, lower fixed.D, ok bool) {
	if i < d.cfg.Length {
		return 0, 0, false
	}
	upper, lower = d.bars[i-1].H, d.bars[i-1].L
	for j := i - d.cfg.Length; j < i-1; j++ {
		if d.bars[j].H.Cmp(upper) > 0 {
			upper = d.bars[j].H
		}
		if d.bars[j].L.Cmp(lower) < 0 {
			lower = d.bars[j].L
		}
	}
	return upper, lower, true
}

// breakAt reports whether the bar at index i closed outside the channel of
// the Length bars before it. Callers hold d.mu.
func (d *Donchian) breakAt(i int) (Break, bool) {
	upper, lower, ok := d.channelBefore(i)
	if !ok {
		return Break{}, false
	}
	b := d.bars[i]
	at := b.Open.Add(d.cfg.Period)
	switch {
	case b.C.Cmp(upper) > 0:
		return Break{Side: venue.Long, At: at, Price: b.C, Level: upper}, true
	case b.C.Cmp(lower) < 0:
		return Break{Side: venue.Short, At: at, Price: b.C, Level: lower}, true
	}
	return Break{}, false
}

// State renders the signal as of now.
func (d *Donchian) State(now time.Time) DonchianState {
	d.mu.Lock()
	defer d.mu.Unlock()
	n := len(d.bars)
	st := DonchianState{Symbol: d.cfg.Symbol, Period: d.cfg.Period, Length: d.cfg.Length, Ready: n >= d.cfg.Length}
	st.Points = make([]DonchianPoint, 0, n+1)
	for i, b := range d.bars {
		p := DonchianPoint{At: b.Open, Open: b.O, High: b.H, Low: b.L, Close: b.C}
		if upper, lower, ok := d.channelBefore(i); ok {
			p.Upper, p.Lower = upper, lower
		}
		st.Points = append(st.Points, p)
	}
	// The channel the forming bar has to break: the last Length closed bars.
	if upper, lower, ok := d.channelBefore(n); ok {
		st.Upper, st.Lower = upper, lower
	}
	if d.forming != nil {
		f := d.forming
		st.Points = append(st.Points, DonchianPoint{At: f.Open, Open: f.O, High: f.H, Low: f.L, Close: f.C, Upper: st.Upper, Lower: st.Lower})
		st.Forming = true
	}
	if d.last != nil {
		br := *d.last
		st.LastBreak = &br
		if exp := br.At.Add(d.cfg.Window); now.Before(exp) {
			st.Window = &Window{Side: br.Side, OpenedAt: br.At, ExpiresAt: exp}
		}
	}
	return st
}
