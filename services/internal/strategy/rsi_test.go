package strategy

import (
	"testing"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
)

func rsiCfg() RSIConfig {
	return RSIConfig{Symbol: "MON", Period: time.Minute, Length: 3, Oversold: fixed.FromInt(30), Overbought: fixed.FromInt(70), Window: 3 * time.Minute, History: 20}
}

// A steady rise saturates the index at 100; a fall after that walks it down
// and, when it enters the oversold zone on a closed bar, opens a long window.
func TestRSIEntersOversoldAndOpensWindow(t *testing.T) {
	r, err := NewRSI(rsiCfg())
	if err != nil {
		t.Fatal(err)
	}
	// closes: 10,11,12,13 → three gains, no losses → RSI 100
	hist := bars(10, 11, 12, 13)
	end := t0.Add(4 * time.Minute)
	r.Seed(hist, end)
	st := r.State(end)
	if !st.Ready || st.Value != fixed.FromInt(100) || st.Window != nil {
		t.Fatalf("after rise: ready=%v value=%s window=%v", st.Ready, st.Value, st.Window)
	}
	// Then it falls hard: the smoothed loss overtakes the smoothed gain.
	falls := []float64{9, 6, 3}
	var last time.Time
	for i, c := range falls {
		open := end.Add(time.Duration(i) * time.Minute)
		d := fixed.MustParse(ftoa(c))
		bar := venue.Candle{Open: open, Period: time.Minute, O: d, H: d, L: d, C: d}
		last = open.Add(time.Minute)
		r.Apply(bar, last)
	}
	st = r.State(last)
	if st.Value.Cmp(fixed.FromInt(30)) > 0 {
		t.Fatalf("rsi after the fall = %s, expected <= 30", st.Value)
	}
	if st.LastCross == nil || st.LastCross.Side != venue.Long {
		t.Fatalf("no long cross: %+v", st.LastCross)
	}
	if st.Window == nil || st.Window.Side != venue.Long {
		t.Fatalf("window = %+v", st.Window)
	}
	if st := r.State(last.Add(3 * time.Minute)); st.Window != nil {
		t.Fatal("window did not expire")
	}
}

// A steady fall then a sharp rise enters the overbought zone: a short window.
func TestRSIEntersOverbought(t *testing.T) {
	r, _ := NewRSI(rsiCfg())
	hist := bars(13, 12, 11, 10, 14, 18, 22)
	end := t0.Add(7 * time.Minute)
	r.Seed(hist, end)
	st := r.State(end)
	if st.Value.Cmp(fixed.FromInt(70)) < 0 || st.Window == nil || st.Window.Side != venue.Short {
		t.Fatalf("value=%s window=%+v", st.Value, st.Window)
	}
}

// Staying inside a zone is not a new signal; only entering it is.
func TestRSIOnlyEntriesSignal(t *testing.T) {
	r, _ := NewRSI(rsiCfg())
	end := t0.Add(8 * time.Minute)
	r.Seed(bars(10, 11, 12, 13, 9, 6, 3, 2), end) // enters oversold at bar 6 (close 3? or 6), then stays
	st := r.State(end)
	if st.LastCross == nil || st.LastCross.Side != venue.Long {
		t.Fatalf("cross = %+v", st.LastCross)
	}
	// The last bar (close 2) is still oversold but it is not a fresh entry:
	// the cross is stamped on the bar that crossed, not the latest one.
	if st.LastCross.At.Equal(end) {
		t.Fatalf("a bar inside the zone counted as a new entry: %v", st.LastCross.At)
	}
}

func TestRSIFlatIsFifty(t *testing.T) {
	r, _ := NewRSI(rsiCfg())
	end := t0.Add(5 * time.Minute)
	r.Seed(bars(10, 10, 10, 10, 10), end)
	if st := r.State(end); st.Value != fixed.FromInt(50) || st.Window != nil {
		t.Fatalf("flat: value=%s window=%v", st.Value, st.Window)
	}
}
