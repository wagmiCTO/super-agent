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
