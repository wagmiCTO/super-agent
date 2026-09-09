package strategy

import (
	"testing"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
)

var t0 = time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)

// bars makes closed one-minute bars from closes, starting at t0.
func bars(closes ...float64) []venue.Candle {
	out := make([]venue.Candle, len(closes))
	for i, c := range closes {
		d := fixed.MustParse(ftoa(c))
		out[i] = venue.Candle{Open: t0.Add(time.Duration(i) * time.Minute), Period: time.Minute, O: d, H: d, L: d, C: d}
	}
	return out
}

func ftoa(f float64) string {
	return fixed.MustParse("1").Mul(fixed.D(f * float64(fixed.Scale))).String()
}

func testCfg() MACrossConfig {
	return MACrossConfig{Symbol: "MON", Period: time.Minute, Fast: 2, Slow: 4, Window: 3 * time.Minute, History: 20}
}

// Flat then rising: the fast average overtakes the slow one on the first
// rising bar that lifts it above; that bar's close opens a long window
// which shuts after Window.
func TestCrossOpensWindowThenExpires(t *testing.T) {
	m, err := NewMACross(testCfg())
	if err != nil {
		t.Fatal(err)
	}
	history := bars(10, 10, 10, 10, 10, 10)
	end := t0.Add(6 * time.Minute)
	m.Seed(history, end)
	st := m.State(end)
	if !st.Ready || st.Trend != TrendFlat || st.Window != nil || st.LastCross != nil {
		t.Fatalf("after flat history: %+v", st)
	}

	// A forming bar is chart, not signal.
	forming := venue.Candle{Open: end, Period: time.Minute, C: fixed.FromInt(20)}
	m.Apply(forming, end.Add(10*time.Second))
	st = m.State(end.Add(10 * time.Second))
	if !st.Forming || st.Window != nil || len(st.Points) != 7 {
		t.Fatalf("forming bar changed the signal: %+v", st)
	}

	// The same bar closes: fast (20+10)/2 > slow (20+10*3)/4 → long cross.
	closed := end.Add(time.Minute)
	m.Apply(forming, closed)
	st = m.State(closed)
	if st.Forming || st.Trend != TrendUp || st.LastCross == nil || st.LastCross.Side != venue.Long || !st.LastCross.At.Equal(closed) {
		t.Fatalf("after the rising bar: %+v", st)
	}
	if st.Window == nil || st.Window.Side != venue.Long || !st.Window.ExpiresAt.Equal(closed.Add(3*time.Minute)) {
		t.Fatalf("window = %+v", st.Window)
	}

	// Three minutes later the invitation is gone; the trend is not.
	st = m.State(closed.Add(3 * time.Minute))
	if st.Window != nil || st.Trend != TrendUp || st.LastCross == nil {
		t.Fatalf("after the window: %+v", st)
	}
}

// A duplicate or stale closed bar must not be counted twice.
func TestStaleBarsIgnored(t *testing.T) {
	m, _ := NewMACross(testCfg())
	m.Seed(bars(10, 10, 10, 10), t0.Add(4*time.Minute))
	n := len(m.State(t0.Add(4 * time.Minute)).Points)
	m.Apply(bars(10, 10, 10, 10)[1], t0.Add(4*time.Minute))
	if got := len(m.State(t0.Add(4 * time.Minute)).Points); got != n {
		t.Fatalf("points %d → %d after a stale bar", n, got)
	}
}

// Seeding with a cross inside the window still offers the entry.
func TestSeedWithRecentCross(t *testing.T) {
	m, _ := NewMACross(testCfg())
	history := bars(10, 10, 10, 10, 10, 10, 20)
	end := t0.Add(7 * time.Minute)
	m.Seed(history, end)
	st := m.State(end)
	if st.Window == nil || st.Window.Side != venue.Long {
		t.Fatalf("recent cross not offered: %+v", st)
	}
	if st.Trend != TrendUp {
		t.Fatalf("trend = %s", st.Trend)
	}
}

// Down cross after an up cross flips the window's side.
func TestDownCross(t *testing.T) {
	m, _ := NewMACross(testCfg())
	end := t0.Add(9 * time.Minute)
	m.Seed(bars(10, 10, 10, 10, 20, 20, 20, 20, 5), end)
	st := m.State(end)
	if st.Window == nil || st.Window.Side != venue.Short || st.Trend != TrendDown {
		t.Fatalf("state = %+v window = %+v", st, st.Window)
	}
}

func TestHistoryTrimmed(t *testing.T) {
	cfg := testCfg()
	cfg.History = 6
	m, _ := NewMACross(cfg)
	m.Seed(bars(1, 2, 3, 4, 5, 6, 7, 8, 9, 10), t0.Add(10*time.Minute))
	if got := len(m.State(t0.Add(10 * time.Minute)).Points); got != 6 {
		t.Fatalf("points = %d, want 6", got)
	}
}

// Up, equal, up is not a cross: an equal bar decides nothing.
func TestEqualBarIsNotACross(t *testing.T) {
	m, _ := NewMACross(testCfg())
	// fast=2 slow=4: closes rise, then a run of equal bars, then rise again.
	end := t0.Add(12 * time.Minute)
	m.Seed(bars(10, 10, 10, 10, 20, 20, 20, 20, 20, 20, 30, 30), end)
	st := m.State(end)
	// The only cross is the first rise (bar 4 closes at 12:05); the later
	// rise from an equal spread continues the same side.
	if st.LastCross == nil || !st.LastCross.At.Equal(t0.Add(5*time.Minute)) {
		t.Fatalf("last cross = %+v", st.LastCross)
	}
}
