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

// Box is the range-breakout signal. The last Length closed bars draw a box —
// their highest high and lowest low. A bar that closes outside the box
// breaks out of it and opens a window in that direction. Waiting inside the
// box costs nothing; that is the strategy's whole economics: the only trades
// it asks for are the ones where the price has already shown it can move.
//
// The box is recomputed from the bars before the breakout bar, so the bar
// that breaks out does not stretch the box it broke.
type Box struct {
	cfg BoxConfig

	mu      sync.Mutex
	bars    []venue.Candle // closed, ascending
	forming *venue.Candle
	last    *Breakout
}

// BoxConfig sizes the box and the window.
type BoxConfig struct {
	Symbol string
	Period time.Duration
	// Length is how many closed bars draw the box.
	Length int
	// Window is how long after a breakout the entry stays offered.
	Window  time.Duration
	History int
}

// DefaultBox ships with a 30-bar box on one-minute bars and a three-minute window.
func DefaultBox(symbol string) BoxConfig {
	return BoxConfig{Symbol: symbol, Period: time.Minute, Length: 30, Window: 3 * time.Minute, History: 120}
}

func (c BoxConfig) validate() error {
	switch {
	case c.Symbol == "":
		return errors.New("strategy: box needs a symbol")
	case c.Period <= 0:
		return errors.New("strategy: box needs a bar period")
	case c.Length < 2:
		return fmt.Errorf("strategy: box needs at least 2 bars, got %d", c.Length)
	case c.Window <= 0:
		return errors.New("strategy: box needs a window")
	case c.History < c.Length+1:
		return fmt.Errorf("strategy: box history %d cannot hold length %d plus one", c.History, c.Length)
	}
	return nil
}

// Breakout is one bar closing outside the box.
type Breakout struct {
	Side venue.Side
	At   time.Time
	// Top and Bottom are the box the bar broke out of.
	Top, Bottom fixed.D
}

// BoxState is what the screen renders.
type BoxState struct {
	Symbol string
	Period time.Duration
	Length int
	// Top and Bottom are the current box: the last Length closed bars.
	Top, Bottom fixed.D
	Points      []Point
	Forming     bool
	Window      *Window
	LastBreak   *Breakout
	Ready       bool
}

func NewBox(cfg BoxConfig) (*Box, error) {
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return &Box{cfg: cfg}, nil
}

// Seed loads closed history, remembering the last breakout in it.
func (b *Box) Seed(bars []venue.Candle, now time.Time) {
	sorted := append([]venue.Candle(nil), bars...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Open.Before(sorted[j].Open) })
	b.mu.Lock()
	defer b.mu.Unlock()
	b.bars = b.bars[:0]
	b.forming = nil
	for _, c := range sorted {
		if !c.Closed(now) {
			f := c
			b.forming = &f
			continue
		}
		if n := len(b.bars); n > 0 && !b.bars[n-1].Open.Before(c.Open) {
			continue
		}
		b.bars = append(b.bars, c)
	}
	b.trimLocked()
	b.last = nil
	for i := b.cfg.Length; i < len(b.bars); i++ {
		if br, ok := b.breakAt(i); ok {
			b.last = &br
		}
	}
}

// Apply feeds one bar from the live stream.
func (b *Box) Apply(c venue.Candle, now time.Time) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if !c.Closed(now) {
		f := c
		b.forming = &f
		return
	}
	if n := len(b.bars); n > 0 && !b.bars[n-1].Open.Before(c.Open) {
		return
	}
	b.bars = append(b.bars, c)
	if b.forming != nil && !b.forming.Open.After(c.Open) {
		b.forming = nil
	}
	b.trimLocked()
	if br, ok := b.breakAt(len(b.bars) - 1); ok {
		b.last = &br
	}
}

func (b *Box) trimLocked() {
	if extra := len(b.bars) - b.cfg.History; extra > 0 {
		b.bars = append(b.bars[:0], b.bars[extra:]...)
	}
}

// boxBefore is the box drawn by the Length bars ending just before index i.
func (b *Box) boxBefore(i int) (top, bottom fixed.D, ok bool) {
	if i < b.cfg.Length {
		return 0, 0, false
	}
	for j := i - b.cfg.Length; j < i; j++ {
		c := b.bars[j]
		if j == i-b.cfg.Length || c.H > top {
			top = c.H
		}
		if j == i-b.cfg.Length || c.L < bottom {
			bottom = c.L
		}
	}
	return top, bottom, true
}

// breakAt reports whether bar i closed outside the box before it.
func (b *Box) breakAt(i int) (Breakout, bool) {
	top, bottom, ok := b.boxBefore(i)
	if !ok {
		return Breakout{}, false
	}
	c := b.bars[i]
	at := c.Open.Add(b.cfg.Period)
	switch {
	case c.C > top:
		return Breakout{Side: venue.Long, At: at, Top: top, Bottom: bottom}, true
	case c.C < bottom:
		return Breakout{Side: venue.Short, At: at, Top: top, Bottom: bottom}, true
	}
	return Breakout{}, false
}

// State renders the signal as of now.
func (b *Box) State(now time.Time) BoxState {
	b.mu.Lock()
	defer b.mu.Unlock()
	st := BoxState{Symbol: b.cfg.Symbol, Period: b.cfg.Period, Length: b.cfg.Length, Ready: len(b.bars) >= b.cfg.Length}
	st.Points = make([]Point, 0, len(b.bars)+1)
	for _, c := range b.bars {
		st.Points = append(st.Points, Point{At: c.Open, Open: c.O, High: c.H, Low: c.L, Close: c.C})
	}
	if b.forming != nil {
		f := b.forming
		st.Points = append(st.Points, Point{At: f.Open, Open: f.O, High: f.H, Low: f.L, Close: f.C})
		st.Forming = true
	}
	if st.Ready {
		st.Top, st.Bottom, _ = b.boxBefore(len(b.bars))
	}
	if b.last != nil {
		br := *b.last
		st.LastBreak = &br
		if exp := br.At.Add(b.cfg.Window); now.Before(exp) {
			st.Window = &Window{Side: br.Side, OpenedAt: br.At, ExpiresAt: exp}
		}
	}
	return st
}
