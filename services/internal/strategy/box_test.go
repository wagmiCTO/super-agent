package strategy

import (
	"testing"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
)

// ohlc makes closed one-minute bars from (low, high, close) triples.
func ohlc(rows ...[3]float64) []venue.Candle {
	out := make([]venue.Candle, len(rows))
	for i, r := range rows {
		out[i] = venue.Candle{
			Open: t0.Add(time.Duration(i) * time.Minute), Period: time.Minute,
			O: fixed.MustParse(ftoa(r[2])), H: fixed.MustParse(ftoa(r[1])), L: fixed.MustParse(ftoa(r[0])), C: fixed.MustParse(ftoa(r[2])),
		}
	}
	return out
}

func boxCfg() BoxConfig {
	return BoxConfig{Symbol: "MON", Period: time.Minute, Length: 3, Window: 3 * time.Minute, History: 20}
}

// Three bars inside 9..11 draw the box; a close above 11 breaks out long and
// opens a window; the box the screen shows now includes the breakout bar.
func TestBreakoutOpensWindow(t *testing.T) {
	b, err := NewBox(boxCfg())
	if err != nil {
		t.Fatal(err)
	}
	hist := ohlc([3]float64{9, 11, 10}, [3]float64{9.5, 10.5, 10}, [3]float64{9, 11, 10.5})
	end := t0.Add(3 * time.Minute)
	b.Seed(hist, end)
	st := b.State(end)
	if !st.Ready || st.Top != fixed.FromInt(11) || st.Bottom != fixed.FromInt(9) || st.Window != nil {
		t.Fatalf("after history: %+v", st)
	}

	bar := venue.Candle{Open: end, Period: time.Minute, O: fixed.MustParse("10.5"), H: fixed.MustParse("12"), L: fixed.MustParse("10.4"), C: fixed.MustParse("11.8")}
	b.Apply(bar, end.Add(30*time.Second)) // forming: no signal yet
	if st := b.State(end.Add(30 * time.Second)); st.Window != nil || !st.Forming {
		t.Fatalf("forming bar signalled: %+v", st)
	}
	closed := end.Add(time.Minute)
	b.Apply(bar, closed)
	st = b.State(closed)
	if st.LastBreak == nil || st.LastBreak.Side != venue.Long || st.LastBreak.Top != fixed.FromInt(11) {
		t.Fatalf("no long breakout: %+v", st.LastBreak)
	}
	if st.Window == nil || st.Window.Side != venue.Long || !st.Window.ExpiresAt.Equal(closed.Add(3*time.Minute)) {
		t.Fatalf("window = %+v", st.Window)
	}
	// The box now includes the breakout bar.
	if st.Top != fixed.FromInt(12) {
		t.Fatalf("box top after breakout = %s", st.Top)
	}
	if st := b.State(closed.Add(3 * time.Minute)); st.Window != nil {
		t.Fatal("window did not expire")
	}
}

func TestBreakdownIsShort(t *testing.T) {
	b, _ := NewBox(boxCfg())
	hist := ohlc([3]float64{9, 11, 10}, [3]float64{9, 11, 10}, [3]float64{9, 11, 10}, [3]float64{8, 10, 8.5})
	end := t0.Add(4 * time.Minute)
	b.Seed(hist, end)
	st := b.State(end)
	if st.Window == nil || st.Window.Side != venue.Short || st.LastBreak.Bottom != fixed.FromInt(9) {
		t.Fatalf("state = %+v window = %+v", st.LastBreak, st.Window)
	}
}

func TestInsideTheBoxIsQuiet(t *testing.T) {
	b, _ := NewBox(boxCfg())
	hist := ohlc([3]float64{9, 11, 10}, [3]float64{9, 11, 10.9}, [3]float64{9.1, 10.9, 9.2}, [3]float64{9.5, 10.5, 10})
	end := t0.Add(4 * time.Minute)
	b.Seed(hist, end)
	if st := b.State(end); st.LastBreak != nil || st.Window != nil {
		t.Fatalf("a bar inside the box signalled: %+v", st.LastBreak)
	}
}
