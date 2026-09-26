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

// ORB is the opening range breakout. A market that never closes still
// wakes up on a clock: when Asia, London and New York sit down, the first
// minutes set a range, and the first close outside that range is the
// day's first decided move. Each session open starts the rule over: the
// bars inside the opening range set its high and low; after the range the
// first bar to close above the high opens a window up, the first to close
// below the low opens one down, and the session is done. A breakout that
// comes hours later is not a breakout of the open, so the watch ends.
//
// Sessions are clock times in UTC, the day every crypto venue prints its
// daily bar on. The range is a stretch of clock time, never less than one
// bar of the timeframe, so the hourly chart's opening range is the hour.
type ORB struct {
	cfg ORBConfig

	mu      sync.Mutex
	bars    []venue.Candle // closed, ascending by open time
	forming *venue.Candle
	cur     *ORBSession // the session the last closed bar belonged to
	last    *Break
}

// ORBConfig sets the clock, the range and the window.
type ORBConfig struct {
	Symbol string
	Period time.Duration
	// Opens are the session opens, as offsets from midnight UTC, ascending.
	Opens []time.Duration
	// Range is how long after the open the range is set; at least one bar.
	Range time.Duration
	// Watch is how long after the open a breakout still counts.
	Watch time.Duration
	// Window is how long after a breakout the entry stays offered.
	Window time.Duration
	// History is how many closed bars to keep for the chart.
	History int
}

// DefaultOpens are the three times a day the market wakes up, in UTC: the
// daily open, London, and New York's cash open.
var DefaultOpens = []time.Duration{0, 8 * time.Hour, 13*time.Hour + 30*time.Minute}

// DefaultORB ships with the classic quarter-hour range, three sessions a
// day, a four-hour watch, on one-minute bars with a three-minute window.
func DefaultORB(symbol string) ORBConfig {
	return ORBConfig{Symbol: symbol, Period: time.Minute, Opens: DefaultOpens, Range: 15 * time.Minute, Watch: 4 * time.Hour, Window: 3 * time.Minute, History: 120}
}

func (c ORBConfig) validate() error {
	switch {
	case c.Symbol == "":
		return errors.New("strategy: orb needs a symbol")
	case c.Period <= 0:
		return errors.New("strategy: orb needs a bar period")
	case len(c.Opens) == 0:
		return errors.New("strategy: orb needs at least one session open")
	case c.Range <= 0:
		return errors.New("strategy: orb needs a range")
	case c.Watch <= c.Range:
		return fmt.Errorf("strategy: orb watch %s must outlast the range %s", c.Watch, c.Range)
	case c.Window <= 0:
		return errors.New("strategy: orb needs a window")
	case c.History < 2:
		return fmt.Errorf("strategy: orb history %d cannot hold two bars", c.History)
	}
	for i, o := range c.Opens {
		if o < 0 || o >= 24*time.Hour || (i > 0 && o <= c.Opens[i-1]) {
			return errors.New("strategy: orb opens must be ascending offsets within a day")
		}
	}
	return nil
}

// rangeSpan is the opening range in clock time: Range, or one bar if a bar
// is longer.
func (c ORBConfig) rangeSpan() time.Duration {
	if c.Period > c.Range {
		return c.Period
	}
	return c.Range
}

// ORBSession is one session's opening range and what came of it.
type ORBSession struct {
	// OpenAt is the session open on the clock.
	OpenAt time.Time
	// RangeFrom and RangeUntil bound the range's bars: those opening in
	// [RangeFrom, RangeUntil). RangeFrom is the bar the open falls in.
	RangeFrom, RangeUntil time.Time
	// WatchUntil is when a breakout stops counting.
	WatchUntil time.Time
	// High and Low are the range so far; Bars is how many closed bars set it.
	High, Low fixed.D
	Bars      int
	// Break is the session's breakout, once it happened.
	Break *Break
}

// ORBPhase is where the current session is.
type ORBPhase string

const (
	// ORBForming: inside the opening range; the high and low are being set.
	ORBForming ORBPhase = "forming"
	// ORBWatching: the range is set; waiting for the first close outside it.
	ORBWatching ORBPhase = "watching"
	// ORBBroken: the session's breakout happened.
	ORBBroken ORBPhase = "broken"
	// ORBClosed: the watch is over, or no bar set a range; waiting for the next open.
	ORBClosed ORBPhase = "closed"
)

// ORBPoint is one bar.
type ORBPoint struct {
	At              time.Time
	Open, High, Low fixed.D
	Close           fixed.D
}

// ORBState is what the screen renders: the session, its range, and the
// invitation.
type ORBState struct {
	Symbol string
	Period time.Duration
	Opens  []time.Duration
	Range  time.Duration
	Watch  time.Duration
	// Session is the current session — the latest open at or before now —
	// with its range as far as it has been set. Never nil.
	Session *ORBSession
	Phase   ORBPhase
	// NextOpenAt is the next session open after now.
	NextOpenAt time.Time
	Points     []ORBPoint
	Forming    bool
	Window     *Window
	LastBreak  *Break
	// Ready is false until a closed bar exists.
	Ready bool
}

// NewORB returns an empty signal; Seed it with enough history to cover the
// current session's watch, or a breakout before the seed is missed.
func NewORB(cfg ORBConfig) (*ORB, error) {
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return &ORB{cfg: cfg}, nil
}

// Lookback is how much closed history a seed needs to know the current
// session in full: its watch, its range, and a bar's slack.
func (c ORBConfig) Lookback() time.Duration {
	return c.Watch + c.rangeSpan() + c.Period
}

// Seed loads closed history and replays the sessions in it.
func (o *ORB) Seed(bars []venue.Candle, now time.Time) {
	sorted := append([]venue.Candle(nil), bars...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Open.Before(sorted[j].Open) })
	o.mu.Lock()
	defer o.mu.Unlock()
	o.bars, o.forming, o.cur, o.last = o.bars[:0], nil, nil, nil
	for _, b := range sorted {
		if !b.Closed(now) {
			f := b
			o.forming = &f
			continue
		}
		if n := len(o.bars); n > 0 && !o.bars[n-1].Open.Before(b.Open) {
			continue
		}
		o.appendLocked(b)
	}
}

// Apply feeds one bar from the live stream.
func (o *ORB) Apply(b venue.Candle, now time.Time) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if !b.Closed(now) {
		f := b
		o.forming = &f
		return
	}
	if n := len(o.bars); n > 0 && !o.bars[n-1].Open.Before(b.Open) {
		return
	}
	o.appendLocked(b)
	if o.forming != nil && !o.forming.Open.After(b.Open) {
		o.forming = nil
	}
}

// appendLocked adds a closed bar, folds it into its session, and checks
// for the session's breakout.
func (o *ORB) appendLocked(b venue.Candle) {
	o.bars = append(o.bars, b)
	if extra := len(o.bars) - o.cfg.History; extra > 0 {
		o.bars = append(o.bars[:0], o.bars[extra:]...)
	}
	s := o.sessionAt(b.Open)
	if o.cur == nil || !o.cur.OpenAt.Equal(s.OpenAt) {
		o.cur = &s
	}
	cur := o.cur
	switch {
	case b.Open.Before(cur.RangeFrom):
		// Before the session's first bar: the tail of the one before.
		return
	case b.Open.Before(cur.RangeUntil):
		if cur.Bars == 0 || b.H.Cmp(cur.High) > 0 {
			cur.High = b.H
		}
		if cur.Bars == 0 || b.L.Cmp(cur.Low) < 0 {
			cur.Low = b.L
		}
		cur.Bars++
	case cur.Bars > 0 && cur.Break == nil && b.Open.Before(cur.WatchUntil):
		at := b.Open.Add(o.cfg.Period)
		switch {
		case b.C.Cmp(cur.High) > 0:
			cur.Break = &Break{Side: venue.Long, At: at, Price: b.C, Level: cur.High}
		case b.C.Cmp(cur.Low) < 0:
			cur.Break = &Break{Side: venue.Short, At: at, Price: b.C, Level: cur.Low}
		}
		if cur.Break != nil {
			br := *cur.Break
			o.last = &br
		}
	}
}

// sessionAt is the session a moment belongs to: the latest open at or
// before it, with its range and watch laid out on the bar grid.
func (o *ORB) sessionAt(t time.Time) ORBSession {
	open, _ := o.opensAround(t)
	from := open.Truncate(o.cfg.Period)
	return ORBSession{OpenAt: open, RangeFrom: from, RangeUntil: from.Add(o.cfg.rangeSpan()), WatchUntil: open.Add(o.cfg.Watch)}
}

// opensAround finds the latest session open at or before t and the first
// one after it, on the UTC clock.
func (o *ORB) opensAround(t time.Time) (last, next time.Time) {
	t = t.UTC()
	midnight := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	for day := -1; day <= 1; day++ {
		base := midnight.AddDate(0, 0, day)
		for _, off := range o.cfg.Opens {
			at := base.Add(off)
			if !at.After(t) {
				last = at
			} else if next.IsZero() {
				next = at
			}
		}
	}
	return last, next
}

// State renders the signal as of now.
func (o *ORB) State(now time.Time) ORBState {
	o.mu.Lock()
	defer o.mu.Unlock()
	st := ORBState{Symbol: o.cfg.Symbol, Period: o.cfg.Period, Opens: append([]time.Duration(nil), o.cfg.Opens...), Range: o.cfg.rangeSpan(), Watch: o.cfg.Watch, Ready: len(o.bars) > 0}
	st.Points = make([]ORBPoint, 0, len(o.bars)+1)
	for _, b := range o.bars {
		st.Points = append(st.Points, ORBPoint{At: b.Open, Open: b.O, High: b.H, Low: b.L, Close: b.C})
	}
	if o.forming != nil {
		f := o.forming
		st.Points = append(st.Points, ORBPoint{At: f.Open, Open: f.O, High: f.H, Low: f.L, Close: f.C})
		st.Forming = true
	}
	// The session on the clock. If the bars have not reached it yet — no
	// bar closed since it opened — it is shown empty rather than the old one.
	_, st.NextOpenAt = o.opensAround(now)
	s := o.sessionAt(now)
	if o.cur != nil && o.cur.OpenAt.Equal(s.OpenAt) {
		s = *o.cur
		if s.Break != nil {
			br := *s.Break
			s.Break = &br
		}
	}
	st.Session = &s
	switch {
	case s.Break != nil:
		st.Phase = ORBBroken
	case now.Before(s.RangeUntil):
		st.Phase = ORBForming
	case s.Bars > 0 && now.Before(s.WatchUntil):
		st.Phase = ORBWatching
	default:
		st.Phase = ORBClosed
	}
	if o.last != nil {
		br := *o.last
		st.LastBreak = &br
		if exp := br.At.Add(o.cfg.Window); now.Before(exp) {
			st.Window = &Window{Side: br.Side, OpenedAt: br.At, ExpiresAt: exp}
		}
	}
	return st
}
