package strategy

import (
	"testing"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
)

// A session at 12:00 UTC (t0), a three-minute range, a ten-minute watch.
func orbCfg() ORBConfig {
	return ORBConfig{Symbol: "MON", Period: time.Minute, Opens: []time.Duration{0, 12 * time.Hour}, Range: 3 * time.Minute, Watch: 10 * time.Minute, Window: 3 * time.Minute, History: 30}
}

// minute makes one closed bar opening i minutes after t0.
func minute(i int, o, h, l, c float64) venue.Candle {
	return venue.Candle{Open: t0.Add(time.Duration(i) * time.Minute), Period: time.Minute, O: fixed.MustParse(ftoa(o)), H: fixed.MustParse(ftoa(h)), L: fixed.MustParse(ftoa(l)), C: fixed.MustParse(ftoa(c))}
}

// The first three bars set the range; a later bar closing above its high
// opens a long window and ends the session's watch.
func TestORBRangeThenBreakUp(t *testing.T) {
	o, err := NewORB(orbCfg())
	if err != nil {
		t.Fatal(err)
	}
	// Inside the range while it forms.
	o.Seed([]venue.Candle{minute(0, 10, 12, 9, 11), minute(1, 11, 11.5, 10, 10.5)}, t0.Add(2*time.Minute))
	st := o.State(t0.Add(2 * time.Minute))
	if st.Phase != ORBForming || st.Session.High.String() != "12" || st.Session.Low.String() != "9" || st.Session.Bars != 2 || !st.Session.OpenAt.Equal(t0) {
		t.Fatalf("forming: phase=%s session=%+v", st.Phase, st.Session)
	}
	if !st.NextOpenAt.Equal(t0.Add(12 * time.Hour)) {
		t.Fatalf("next open = %v", st.NextOpenAt)
	}
	// The range closes; a bar inside it is nothing.
	o.Apply(minute(2, 10.5, 11, 10, 10.8), t0.Add(3*time.Minute))
	o.Apply(minute(3, 10.8, 11.9, 10.2, 11.5), t0.Add(4*time.Minute))
	st = o.State(t0.Add(4 * time.Minute))
	if st.Phase != ORBWatching || st.LastBreak != nil || st.Window != nil {
		t.Fatalf("watching: phase=%s break=%v window=%v", st.Phase, st.LastBreak, st.Window)
	}
	// A wick above the high that closes inside is nothing either.
	o.Apply(minute(4, 11.5, 12.6, 11, 11.9), t0.Add(5*time.Minute))
	if st := o.State(t0.Add(5 * time.Minute)); st.LastBreak != nil {
		t.Fatalf("wick counted as a break: %+v", st.LastBreak)
	}
	// The close above 12 is the breakout.
	o.Apply(minute(5, 11.9, 12.8, 11.8, 12.5), t0.Add(6*time.Minute))
	st = o.State(t0.Add(6 * time.Minute))
	if st.Phase != ORBBroken || st.LastBreak == nil || st.LastBreak.Side != venue.Long || st.LastBreak.Level.String() != "12" || !st.LastBreak.At.Equal(t0.Add(6*time.Minute)) {
		t.Fatalf("break: phase=%s break=%+v", st.Phase, st.LastBreak)
	}
	if st.Window == nil || st.Window.Side != venue.Long || !st.Window.ExpiresAt.Equal(t0.Add(9*time.Minute)) {
		t.Fatalf("window = %+v", st.Window)
	}
	// A close back below the low later is not a second signal this session.
	o.Apply(minute(6, 12.5, 12.5, 8, 8.5), t0.Add(7*time.Minute))
	if st := o.State(t0.Add(7 * time.Minute)); st.LastBreak.Side != venue.Long {
		t.Fatalf("second break counted: %+v", st.LastBreak)
	}
	if st := o.State(t0.Add(9 * time.Minute)); st.Window != nil {
		t.Fatal("window did not expire")
	}
}

// A close below the range's low breaks out down; after the watch the
// session is closed and a late breakout is nothing.
func TestORBBreakDownAndWatchEnds(t *testing.T) {
	o, _ := NewORB(orbCfg())
	bars := []venue.Candle{minute(0, 10, 12, 9, 11), minute(1, 11, 11.5, 10, 10.5), minute(2, 10.5, 11, 10, 10.8), minute(3, 10.8, 11, 8.5, 8.7)}
	o.Seed(bars, t0.Add(4*time.Minute))
	st := o.State(t0.Add(4 * time.Minute))
	if st.LastBreak == nil || st.LastBreak.Side != venue.Short || st.LastBreak.Level.String() != "9" {
		t.Fatalf("break = %+v", st.LastBreak)
	}

	late, _ := NewORB(orbCfg())
	late.Seed(bars[:3], t0.Add(3*time.Minute))
	// Quiet through the watch, then a break at minute 12: two minutes late.
	for i := 3; i < 12; i++ {
		late.Apply(minute(i, 10.5, 11, 10, 10.5), t0.Add(time.Duration(i+1)*time.Minute))
	}
	if st := late.State(t0.Add(11 * time.Minute)); st.Phase != ORBClosed {
		t.Fatalf("phase after the watch = %s", st.Phase)
	}
	late.Apply(minute(12, 10.5, 14, 10, 13), t0.Add(13*time.Minute))
	if st := late.State(t0.Add(13 * time.Minute)); st.LastBreak != nil || st.Phase != ORBClosed {
		t.Fatalf("late break counted: phase=%s break=%+v", st.Phase, st.LastBreak)
	}
}

// The next session open starts the rule over, and a session no bar has
// reached yet is shown empty.
func TestORBNewSessionResets(t *testing.T) {
	o, _ := NewORB(orbCfg())
	o.Seed([]venue.Candle{minute(0, 10, 12, 9, 11), minute(1, 11, 11.5, 10, 10.5), minute(2, 10.5, 11, 10, 10.8), minute(3, 10.8, 13, 10.2, 12.5)}, t0.Add(4*time.Minute))
	if st := o.State(t0.Add(4 * time.Minute)); st.Phase != ORBBroken {
		t.Fatalf("phase = %s", st.Phase)
	}
	// Midnight: a new session on the clock, no bars yet.
	next := t0.Add(12 * time.Hour)
	st := o.State(next.Add(time.Minute))
	if st.Phase != ORBForming || st.Session.Bars != 0 || !st.Session.OpenAt.Equal(next) || st.Window != nil {
		t.Fatalf("new session: phase=%s session=%+v", st.Phase, st.Session)
	}
	// The old breakout is still the last one, offered or not.
	if st.LastBreak == nil || !st.LastBreak.At.Equal(t0.Add(4*time.Minute)) {
		t.Fatalf("last break = %+v", st.LastBreak)
	}
	// Its first bar sets a fresh range.
	b := minute(0, 20, 21, 19, 20.5)
	b.Open = next
	o.Apply(b, next.Add(time.Minute))
	st = o.State(next.Add(time.Minute))
	if st.Session.Bars != 1 || st.Session.High.String() != "21" || st.Session.Break != nil {
		t.Fatalf("fresh range: %+v", st.Session)
	}
}

// A session open that falls inside a bar takes that bar as its first; the
// range is never shorter than one bar.
func TestORBRangeOnTheBarGrid(t *testing.T) {
	cfg := orbCfg()
	cfg.Period, cfg.History = time.Hour, 10
	cfg.Opens = []time.Duration{13*time.Hour + 30*time.Minute}
	cfg.Range, cfg.Watch = 15*time.Minute, 4*time.Hour
	o, _ := NewORB(cfg)
	day := time.Date(2026, 9, 10, 0, 0, 0, 0, time.UTC)
	s := o.sessionAt(day.Add(15 * time.Hour))
	if !s.RangeFrom.Equal(day.Add(13*time.Hour)) || !s.RangeUntil.Equal(day.Add(14*time.Hour)) || !s.WatchUntil.Equal(day.Add(17*time.Hour+30*time.Minute)) {
		t.Fatalf("session = %+v", s)
	}
	if got := cfg.Lookback(); got != 4*time.Hour+time.Hour+time.Hour {
		t.Fatalf("lookback = %s", got)
	}
}

func TestORBConfigRejectsBadOpens(t *testing.T) {
	for _, opens := range [][]time.Duration{nil, {8 * time.Hour, 8 * time.Hour}, {25 * time.Hour}, {8 * time.Hour, time.Hour}} {
		cfg := orbCfg()
		cfg.Opens = opens
		if _, err := NewORB(cfg); err == nil {
			t.Errorf("opens %v accepted", opens)
		}
	}
}
