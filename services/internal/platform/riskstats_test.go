package platform

import (
	"math"
	"strconv"
	"testing"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/store"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
)

func TestStats(t *testing.T) {
	base := time.Date(2026, 9, 11, 12, 0, 0, 0, time.UTC)
	tr := func(pnl string, fee string, reason string, minutesAgo int) store.ClosedTrade {
		closed := base.Add(-time.Duration(minutesAgo) * time.Minute)
		return store.ClosedTrade{PnL: fixed.MustParse(pnl), EntryFee: fixed.MustParse(fee), ExitFee: fixed.MustParse(fee), CloseReason: reason, OpenedAt: closed.Add(-10 * time.Minute), ClosedAt: closed}
	}
	// Arrival order is not close order: the streak and drawdown must not care.
	trades := []store.ClosedTrade{
		tr("-1", "0.01", "stop", 10),   // latest
		tr("2", "0.01", "horizon", 20), //
		tr("3", "0.01", "manual", 30),  //
		tr("-2", "0.01", "horizon", 40),
		tr("-1", "0.01", "manual", 50), // earliest
		{PnL: fixed.MustParse("9")},    // still open: ignored
	}
	st := Stats(trades, time.Time{})
	if st.Trades != 5 || st.Wins != 2 || st.Losses != 3 {
		t.Fatalf("counts = %+v", st)
	}
	if st.PnL != fixed.MustParse("1") || st.Fees != fixed.MustParse("0.1") {
		t.Fatalf("pnl %s fees %s", st.PnL, st.Fees)
	}
	if st.Best != fixed.MustParse("3") || st.Worst != fixed.MustParse("-2") {
		t.Fatalf("best %s worst %s", st.Best, st.Worst)
	}
	if st.AvgWin != fixed.MustParse("2.5") || st.AvgLoss.String() != "-1.33333333" {
		t.Fatalf("avg win %s avg loss %s", st.AvgWin, st.AvgLoss)
	}
	// Running: -1, -3, 0, 2, 1 → peak 2 after the fourth, drawdown 3 at the second.
	if st.MaxDrawdown != fixed.MustParse("3") {
		t.Fatalf("max drawdown %s", st.MaxDrawdown)
	}
	if st.Streak != -1 || st.ByReason["horizon"] != 2 || st.ByReason["stop"] != 1 || st.AvgHold != 10*time.Minute {
		t.Fatalf("streak %d reasons %v hold %s", st.Streak, st.ByReason, st.AvgHold)
	}
	if w := st.WinRate(); math.Abs(w-0.4) > 1e-9 {
		t.Fatalf("win rate %v", w)
	}
	// A window keeps only what closed inside it.
	if s := Stats(trades, base.Add(-25*time.Minute)); s.Trades != 2 || s.PnL != fixed.MustParse("1") {
		t.Fatalf("windowed = %+v", s)
	}
	if s := Stats(nil, time.Time{}); s.Trades != 0 || s.WinRate() != 0 {
		t.Fatalf("empty = %+v", s)
	}
}

func TestVolatility(t *testing.T) {
	// Closes alternate ±1%: log-return stdev ≈ 1% = 100 bps; ranges 2% = 200 bps.
	var cs []venue.Candle
	price := 100.0
	t0 := time.Date(2026, 9, 11, 12, 0, 0, 0, time.UTC)
	for i := 0; i < 20; i++ {
		if i%2 == 0 {
			price *= 1.01
		} else {
			price /= 1.01
		}
		c := fixed.MustParse(trimFloat(price))
		cs = append(cs, venue.Candle{Open: t0.Add(time.Duration(i) * time.Minute), Period: time.Minute, O: c, H: c.Mul(fixed.MustParse("1.01")), L: c.Mul(fixed.MustParse("0.99")), C: c})
	}
	// Shuffle the order: the function sorts.
	cs[0], cs[5] = cs[5], cs[0]
	m := Volatility("MON", cs, 6.9)
	if m.Bars != 20 || math.Abs(m.Vol1mBps-100) > 3 || math.Abs(m.Range1mBps-200) > 1 {
		t.Fatalf("market = %+v", m)
	}
	if math.Abs(m.Edge-100/6.9) > 0.5 {
		t.Fatalf("edge = %v", m.Edge)
	}
	if e := Volatility("MON", cs[:2], 6.9); e.Vol1mBps != 0 || e.Bars != 2 {
		t.Fatalf("too few bars = %+v", e)
	}
}

func trimFloat(f float64) string { return strconv.FormatFloat(f, 'f', 6, 64) }
