package platform

import (
	"context"
	"testing"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
)

// The signal is seeded from history, then follows the live stream: a bar
// that closes with the fast average above the slow one opens a long window.
func TestSignalsSeedThenStream(t *testing.T) {
	t0 := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)
	flat := fixed.FromInt(10)
	var history []venue.Candle
	for i := 0; i < 30; i++ {
		history = append(history, venue.Candle{Open: t0.Add(time.Duration(i) * time.Minute), Period: time.Minute, C: flat})
	}
	stream := make(chan venue.Candle, 4)
	fv := &fakeVenue{candles: history, candleStream: stream}

	now := t0.Add(30 * time.Minute)
	sig := NewSignals(fv, nil)
	sig.now = func() time.Time { return now }
	sig.seedGap = 0
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go sig.Run(ctx, []string{"mon"})

	waitFor(t, func() bool { st, ok := sig.MACross("MON"); return ok && st.Ready })
	st, _ := sig.MACross("MON")
	if st.Window != nil || len(st.Points) != 30 {
		t.Fatalf("after seed: window=%v points=%d", st.Window, len(st.Points))
	}

	// A bar closes well above the flat history.
	stream <- venue.Candle{Open: now, Period: time.Minute, C: fixed.FromInt(20)}
	now = now.Add(time.Minute) // the bar is closed by the time it is applied
	stream <- venue.Candle{Open: now.Add(-time.Minute), Period: time.Minute, C: fixed.FromInt(20)}
	waitFor(t, func() bool { st, _ := sig.MACross("MON"); return st.Window != nil })
	st, _ = sig.MACross("MON")
	if st.Window.Side != venue.Long || st.Trend != "up" {
		t.Fatalf("window = %+v trend = %s", st.Window, st.Trend)
	}
	if _, ok := sig.MACross("BTC"); ok {
		t.Fatal("unknown symbol has a signal")
	}
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("condition not met in time")
}

// Minute bars fold into larger ones: a new bucket closes the one before
// it, and a minute repeated while it forms replaces its own contribution.
func TestBarBuilderFoldsMinutes(t *testing.T) {
	t0 := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)
	b := &barBuilder{period: 5 * time.Minute}
	minute := func(i int, o, h, l, c int64, v int64) venue.Candle {
		return venue.Candle{Open: t0.Add(time.Duration(i) * time.Minute), Period: time.Minute, O: fixed.FromInt(o), H: fixed.FromInt(h), L: fixed.FromInt(l), C: fixed.FromInt(c), Volume: fixed.FromInt(v)}
	}
	out := b.add(minute(0, 10, 12, 9, 11, 1))
	if len(out) != 1 || !out[0].Open.Equal(t0) || out[0].Period != 5*time.Minute {
		t.Fatalf("first minute: %+v", out)
	}
	// The same minute, still forming, with a higher high and more volume.
	out = b.add(minute(0, 10, 14, 9, 13, 3))
	if len(out) != 1 || out[0].H.String() != "14" || out[0].Volume.String() != "3" {
		t.Fatalf("repeated minute: %+v", out)
	}
	for i := 1; i < 5; i++ {
		out = b.add(minute(i, 13, 13, 8, 12, 1))
	}
	if len(out) != 1 || out[0].L.String() != "8" || out[0].C.String() != "12" || out[0].Volume.String() != "7" {
		t.Fatalf("bucket forming: %+v", out)
	}
	// The first minute of the next bucket closes the first bar.
	out = b.add(minute(5, 12, 12, 12, 12, 1))
	if len(out) != 2 || !out[0].Open.Equal(t0) || out[0].O.String() != "10" || out[0].C.String() != "12" || !out[1].Open.Equal(t0.Add(5*time.Minute)) {
		t.Fatalf("next bucket: %+v", out)
	}
}
