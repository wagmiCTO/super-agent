package strategy

import (
	"testing"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
)

func donchianCfg() DonchianConfig {
	return DonchianConfig{Symbol: "MON", Period: time.Minute, Length: 3, Window: 3 * time.Minute, History: 20}
}

// ohlc makes closed one-minute bars from open/high/low/close quadruples,
// starting at t0.
func ohlc(q ...float64) []venue.Candle {
	out := make([]venue.Candle, 0, len(q)/4)
	for i := 0; i+3 < len(q); i += 4 {
		out = append(out, venue.Candle{
			Open: t0.Add(time.Duration(len(out)) * time.Minute), Period: time.Minute,
			O: fixed.MustParse(ftoa(q[i])), H: fixed.MustParse(ftoa(q[i+1])), L: fixed.MustParse(ftoa(q[i+2])), C: fixed.MustParse(ftoa(q[i+3])),
		})
	}
	return out
}

// A range of three bars sets the channel; a bar closing above every high of
// it breaks out up and opens a long window, which expires after Window.
func TestDonchianCloseAboveChannelOpensWindow(t *testing.T) {
	d, err := NewDonchian(donchianCfg())
	if err != nil {
		t.Fatal(err)
	}
	// Three bars between 9 and 12, then a close at 13.
	hist := ohlc(10, 12, 9, 11, 11, 12, 10, 10, 10, 11, 9, 10)
	end := t0.Add(3 * time.Minute)
	d.Seed(hist, end)
	st := d.State(end)
	if !st.Ready || st.Upper.String() != "12" || st.Lower.String() != "9" || st.Window != nil {
		t.Fatalf("channel: ready=%v upper=%s lower=%s window=%v", st.Ready, st.Upper, st.Lower, st.Window)
	}
	bar := ohlc(10, 13.5, 10, 13)[0]
	bar.Open = end
	d.Apply(bar, end.Add(time.Minute))
	st = d.State(end.Add(time.Minute))
	if st.LastBreak == nil || st.LastBreak.Side != venue.Long || st.LastBreak.Level.String() != "12" || st.LastBreak.Price.String() != "13" {
		t.Fatalf("break = %+v", st.LastBreak)
	}
	if st.Window == nil || st.Window.Side != venue.Long || !st.Window.ExpiresAt.Equal(end.Add(4*time.Minute)) {
		t.Fatalf("window = %+v", st.Window)
	}
	// The channel now includes the breakout bar.
	if st.Upper.String() != "13.5" {
		t.Fatalf("upper after break = %s", st.Upper)
	}
	if st := d.State(end.Add(4 * time.Minute)); st.Window != nil {
		t.Fatal("window did not expire")
	}
}

// A wick beyond the channel that closes back inside it is not a breakout;
// a close below every low is one, down.
func TestDonchianWickIsNotABreak(t *testing.T) {
	d, _ := NewDonchian(donchianCfg())
	// Three bars 9..12, a spike to 14 closing at 11, then a close at 8.
	end := t0.Add(5 * time.Minute)
	d.Seed(ohlc(10, 12, 9, 11, 11, 12, 10, 10, 10, 11, 9, 10, 10, 14, 10, 11, 11, 11, 7.5, 8), end)
	st := d.State(end)
	if st.LastBreak == nil || st.LastBreak.Side != venue.Short || !st.LastBreak.At.Equal(end) {
		t.Fatalf("break = %+v", st.LastBreak)
	}
	if st.Points[3].Upper.String() != "12" || st.Points[4].Upper.String() != "14" {
		t.Fatalf("channel per bar = %s / %s", st.Points[3].Upper, st.Points[4].Upper)
	}
}

// Not enough bars: no channel, no signal, not ready.
func TestDonchianWarmsUp(t *testing.T) {
	d, _ := NewDonchian(donchianCfg())
	end := t0.Add(2 * time.Minute)
	d.Seed(ohlc(10, 12, 9, 11, 11, 20, 10, 19), end)
	st := d.State(end)
	if st.Ready || st.LastBreak != nil || !st.Upper.IsZero() {
		t.Fatalf("warming up: ready=%v break=%v upper=%s", st.Ready, st.LastBreak, st.Upper)
	}
}

// The forming bar is kept for the chart with the channel it has to break,
// and a closed bar repeated is ignored.
func TestDonchianFormingBar(t *testing.T) {
	d, _ := NewDonchian(donchianCfg())
	hist := ohlc(10, 12, 9, 11, 11, 12, 10, 10, 10, 11, 9, 10)
	end := t0.Add(3 * time.Minute)
	d.Seed(hist, end)
	forming := ohlc(10, 13, 10, 12.5)[0]
	forming.Open = end
	d.Apply(forming, end.Add(30*time.Second))
	st := d.State(end.Add(30 * time.Second))
	if !st.Forming || len(st.Points) != 4 || st.Points[3].Upper.String() != "12" || st.LastBreak != nil {
		t.Fatalf("forming: %v points=%d upper=%s break=%v", st.Forming, len(st.Points), st.Points[3].Upper, st.LastBreak)
	}
	d.Apply(hist[2], end)
	if got := len(d.State(end).Points); got != 4 {
		t.Fatalf("stale bar changed the points: %d", got)
	}
}
