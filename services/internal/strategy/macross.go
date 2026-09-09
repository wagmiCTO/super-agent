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

// MACross is the trend signal: a fast moving average crossing a slow one on
// closed bars. A cross opens a window — for a while the screen lights up and
// offers an entry in the cross's direction. The user takes it or not; the
// signal never places anything.
//
// Only closed bars count. The forming bar is kept for the chart, but a cross
// that appears and disappears inside a bar is noise, not a signal.
type MACross struct {
	cfg MACrossConfig

	mu      sync.Mutex
	bars    []venue.Candle // closed, ascending by open time
	forming *venue.Candle
	last    *Cross
}

// MACrossConfig sizes the averages and the window.
type MACrossConfig struct {
	Symbol string
	Period time.Duration
	Fast   int
	Slow   int
	// Window is how long after a cross the entry stays offered.
	Window time.Duration
	// History is how many closed bars to keep for the chart and the averages.
	History int
}

// DefaultMACross is the configuration the MA Cross strategy ships with:
// one-minute bars, 5 over 20, a three-minute window.
func DefaultMACross(symbol string) MACrossConfig {
	return MACrossConfig{Symbol: symbol, Period: time.Minute, Fast: 5, Slow: 20, Window: 3 * time.Minute, History: 120}
}

func (c MACrossConfig) validate() error {
	switch {
	case c.Symbol == "":
		return errors.New("strategy: ma cross needs a symbol")
	case c.Period <= 0:
		return errors.New("strategy: ma cross needs a bar period")
	case c.Fast < 1 || c.Slow <= c.Fast:
		return fmt.Errorf("strategy: ma cross needs 1 <= fast < slow, got %d/%d", c.Fast, c.Slow)
	case c.Window <= 0:
		return errors.New("strategy: ma cross needs a window")
	case c.History < c.Slow+1:
		return fmt.Errorf("strategy: ma cross history %d cannot hold slow %d plus one", c.History, c.Slow)
	}
	return nil
}

// Cross is one crossing of the averages.
type Cross struct {
	// Side is the direction the cross points: Long when the fast average
	// rose above the slow one.
	Side venue.Side
	// At is when the bar that produced the cross closed.
	At time.Time
}

// Trend is which average is on top.
type Trend string

const (
	TrendUp   Trend = "up"
	TrendDown Trend = "down"
	TrendFlat Trend = "flat"
)

// Point is one bar's close with the averages as of that bar; the averages
// are zero while there is not enough history.
type Point struct {
	At              time.Time
	Open, High, Low fixed.D
	Close           fixed.D
	Fast            fixed.D
	Slow            fixed.D
}

// Window is an open invitation to enter.
type Window struct {
	Side      venue.Side
	OpenedAt  time.Time
	ExpiresAt time.Time
}

// MACrossState is what the screen renders.
type MACrossState struct {
	Symbol string
	Period time.Duration
	Fast   int
	Slow   int
	// Points are the closed bars, oldest first, followed by the forming bar
	// when there is one (Forming reports whether the last point is it).
	Points  []Point
	Forming bool
	Trend   Trend
	// Window is set while a cross's entry is still offered.
	Window *Window
	// LastCross is the most recent cross, offered or not.
	LastCross *Cross
	// Ready is false until Slow closed bars exist.
	Ready bool
}

// NewMACross returns an empty signal; Seed it with history before feeding
// live bars, or the first crosses will be missed.
func NewMACross(cfg MACrossConfig) (*MACross, error) {
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return &MACross{cfg: cfg}, nil
}

// Seed loads closed history. Bars are sorted and deduplicated by open time;
// the forming bar, if included, is kept aside. The last cross in the history
// is remembered but does not open a window: it is old news.
func (m *MACross) Seed(bars []venue.Candle, now time.Time) {
	sorted := append([]venue.Candle(nil), bars...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Open.Before(sorted[j].Open) })

	m.mu.Lock()
	defer m.mu.Unlock()
	m.bars = m.bars[:0]
	m.forming = nil
	for _, b := range sorted {
		if !b.Closed(now) {
			f := b
			m.forming = &f
			continue
		}
		if n := len(m.bars); n > 0 && !m.bars[n-1].Open.Before(b.Open) {
			continue
		}
		m.bars = append(m.bars, b)
	}
	m.trimLocked()
	// Replay the history for the last cross. A cross inside the last
	// Window is still an invitation — the user does not care whether the
	// platform was watching when it happened.
	m.last = nil
	for i := m.cfg.Slow; i < len(m.bars); i++ {
		if c, ok := m.crossAt(i); ok {
			m.last = &c
		}
	}
}

// Apply feeds one bar from the live stream. A bar for an open time already
// closed is ignored; the forming bar is replaced; a bar that just closed is
// appended and checked for a cross.
func (m *MACross) Apply(b venue.Candle, now time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !b.Closed(now) {
		f := b
		m.forming = &f
		return
	}
	if n := len(m.bars); n > 0 && !m.bars[n-1].Open.Before(b.Open) {
		return
	}
	m.bars = append(m.bars, b)
	if m.forming != nil && !m.forming.Open.After(b.Open) {
		m.forming = nil
	}
	m.trimLocked()
	if c, ok := m.crossAt(len(m.bars) - 1); ok {
		m.last = &c
	}
}

func (m *MACross) trimLocked() {
	if extra := len(m.bars) - m.cfg.History; extra > 0 {
		m.bars = append(m.bars[:0], m.bars[extra:]...)
	}
}

// crossAt reports whether the bar at index i closed with the averages on
// the other side of each other than at i-1. Callers hold m.mu.
func (m *MACross) crossAt(i int) (Cross, bool) {
	if i < m.cfg.Slow {
		return Cross{}, false
	}
	cur := m.spreadAt(i)
	if cur == 0 {
		return Cross{}, false
	}
	// Compare with the last bar where the averages were apart. Bars where
	// they were exactly equal decide nothing: up, equal, up is not a cross,
	// while a flat history followed by a move is one.
	prev := 0
	for j := i - 1; j >= m.cfg.Slow-1 && prev == 0; j-- {
		prev = m.spreadAt(j)
	}
	if prev != 0 && (prev > 0) == (cur > 0) {
		return Cross{}, false
	}
	side := venue.Long
	if cur < 0 {
		side = venue.Short
	}
	return Cross{Side: side, At: m.bars[i].Open.Add(m.cfg.Period)}, true
}

// spreadAt is sign(fast - slow) at index i: +1, -1, or 0 when equal or not
// enough history. Callers hold m.mu.
func (m *MACross) spreadAt(i int) int {
	if i+1 < m.cfg.Slow {
		return 0
	}
	fast := m.averageAt(i, m.cfg.Fast)
	slow := m.averageAt(i, m.cfg.Slow)
	return fast.Cmp(slow)
}

// averageAt is the simple moving average of the closes ending at index i.
func (m *MACross) averageAt(i, n int) fixed.D {
	var sum fixed.D
	for j := i - n + 1; j <= i; j++ {
		sum = sum.Add(m.bars[j].C)
	}
	return sum.Div(fixed.FromInt(int64(n)))
}

// State renders the signal as of now.
func (m *MACross) State(now time.Time) MACrossState {
	m.mu.Lock()
	defer m.mu.Unlock()
	st := MACrossState{
		Symbol: m.cfg.Symbol, Period: m.cfg.Period, Fast: m.cfg.Fast, Slow: m.cfg.Slow,
		Trend: TrendFlat, Ready: len(m.bars) >= m.cfg.Slow,
	}
	st.Points = make([]Point, 0, len(m.bars)+1)
	for i, b := range m.bars {
		p := Point{At: b.Open, Open: b.O, High: b.H, Low: b.L, Close: b.C}
		if i+1 >= m.cfg.Fast {
			p.Fast = m.averageAt(i, m.cfg.Fast)
		}
		if i+1 >= m.cfg.Slow {
			p.Slow = m.averageAt(i, m.cfg.Slow)
		}
		st.Points = append(st.Points, p)
	}
	if m.forming != nil {
		f := m.forming
		st.Points = append(st.Points, Point{At: f.Open, Open: f.O, High: f.H, Low: f.L, Close: f.C})
		st.Forming = true
	}
	if n := len(m.bars); n > 0 {
		switch m.spreadAt(n - 1) {
		case 1:
			st.Trend = TrendUp
		case -1:
			st.Trend = TrendDown
		}
	}
	if m.last != nil {
		c := *m.last
		st.LastCross = &c
		if exp := c.At.Add(m.cfg.Window); now.Before(exp) {
			st.Window = &Window{Side: c.Side, OpenedAt: c.At, ExpiresAt: exp}
		}
	}
	return st
}
