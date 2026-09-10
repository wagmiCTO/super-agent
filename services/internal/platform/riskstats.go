package platform

import (
	"math"
	"sort"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/store"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
)

// PerfStats is a run of round trips summed up the way a risk screen reads
// it: how many, how they went, what they cost, how deep the worst run was.
type PerfStats struct {
	Trades  int
	Wins    int
	Losses  int
	PnL     fixed.D // realized, net of fees
	Fees    fixed.D
	Best    fixed.D
	Worst   fixed.D
	AvgWin  fixed.D
	AvgLoss fixed.D
	// MaxDrawdown is the largest fall of the running PnL from a peak.
	MaxDrawdown fixed.D
	// AvgHold is the mean time from entry to exit.
	AvgHold time.Duration
	// ByReason counts closes by who closed: manual, horizon, stop.
	ByReason map[string]int
	// Streak is the current run: positive for wins in a row, negative for
	// losses in a row, by closing time.
	Streak int
}

// WinRate is wins over decided trades, 0..1; zero without trades.
func (p PerfStats) WinRate() float64 {
	if p.Wins+p.Losses == 0 {
		return 0
	}
	return float64(p.Wins) / float64(p.Wins+p.Losses)
}

// Stats sums closed trades from `since` (zero means all). Trades are
// ordered by close time before drawdown and streak are read, whichever
// order they arrived in.
func Stats(trades []store.ClosedTrade, since time.Time) PerfStats {
	rows := make([]store.ClosedTrade, 0, len(trades))
	for _, t := range trades {
		if t.ClosedAt.IsZero() || (!since.IsZero() && t.ClosedAt.Before(since)) {
			continue
		}
		rows = append(rows, t)
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].ClosedAt.Before(rows[j].ClosedAt) })
	st := PerfStats{ByReason: map[string]int{}}
	var running, peak, wins, losses fixed.D
	var hold time.Duration
	for i, t := range rows {
		st.Trades++
		st.PnL = st.PnL.Add(t.PnL)
		st.Fees = st.Fees.Add(t.EntryFee).Add(t.ExitFee)
		if reason := t.CloseReason; reason != "" {
			st.ByReason[reason]++
		}
		switch {
		case t.PnL.IsPos():
			st.Wins++
			wins = wins.Add(t.PnL)
			if st.Streak >= 0 {
				st.Streak++
			} else {
				st.Streak = 1
			}
		case t.PnL.IsNeg():
			st.Losses++
			losses = losses.Add(t.PnL)
			if st.Streak <= 0 {
				st.Streak--
			} else {
				st.Streak = -1
			}
		}
		if i == 0 || t.PnL.Cmp(st.Best) > 0 {
			st.Best = t.PnL
		}
		if i == 0 || t.PnL.Cmp(st.Worst) < 0 {
			st.Worst = t.PnL
		}
		running = running.Add(t.PnL)
		if running.Cmp(peak) > 0 {
			peak = running
		}
		if dd := peak.Sub(running); dd.Cmp(st.MaxDrawdown) > 0 {
			st.MaxDrawdown = dd
		}
		if !t.OpenedAt.IsZero() {
			hold += t.ClosedAt.Sub(t.OpenedAt)
		}
	}
	if st.Wins > 0 {
		st.AvgWin = wins.Div(fixed.FromInt(int64(st.Wins)))
	}
	if st.Losses > 0 {
		st.AvgLoss = losses.Div(fixed.FromInt(int64(st.Losses)))
	}
	if st.Trades > 0 {
		st.AvgHold = hold / time.Duration(st.Trades)
	}
	return st
}

// StartOfDay and StartOfWeek are the windows the risk screen reports on,
// in UTC — the same clock the leaderboard's week runs on.
func StartOfDay(now time.Time) time.Time {
	y, m, d := now.UTC().Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

func StartOfWeek(now time.Time) time.Time { return WeekStart(WeekOf(now)) }

// MarketRisk is what the market itself costs and gives: the fee to get in
// and out against how much the price moves in a minute. A strategy on
// one-minute bars only has an edge when the move is a multiple of the fee.
type MarketRisk struct {
	Symbol string
	// Vol1mBps is the standard deviation of one-minute log returns, in
	// basis points, over the last hour of closed bars.
	Vol1mBps float64
	// Range1mBps is the mean bar range (high-low over close), in bps.
	Range1mBps float64
	// RoundTripBps is the taker fee in and out, from the venue's schedule.
	RoundTripBps float64
	// Edge is Vol1mBps over RoundTripBps: below 1 the fee eats a typical
	// minute; the strategies were sized for 5 and above.
	Edge float64
	Bars int
}

// Volatility computes MarketRisk from closed one-minute candles, oldest
// first is not required.
func Volatility(symbol string, candles []venue.Candle, roundTripBps float64) MarketRisk {
	cs := append([]venue.Candle(nil), candles...)
	sort.Slice(cs, func(i, j int) bool { return cs[i].Open.Before(cs[j].Open) })
	m := MarketRisk{Symbol: symbol, RoundTripBps: roundTripBps, Bars: len(cs)}
	if len(cs) < 3 {
		return m
	}
	var rets []float64
	var rangeSum float64
	for i := range cs {
		c := cs[i].C.Float64()
		if c <= 0 {
			continue
		}
		rangeSum += (cs[i].H.Float64() - cs[i].L.Float64()) / c
		if i > 0 && cs[i-1].C.Float64() > 0 {
			rets = append(rets, math.Log(c/cs[i-1].C.Float64()))
		}
	}
	if len(rets) < 2 {
		return m
	}
	var mean float64
	for _, r := range rets {
		mean += r
	}
	mean /= float64(len(rets))
	var v float64
	for _, r := range rets {
		v += (r - mean) * (r - mean)
	}
	v /= float64(len(rets) - 1)
	m.Vol1mBps = math.Sqrt(v) * 1e4
	m.Range1mBps = rangeSum / float64(len(cs)) * 1e4
	if roundTripBps > 0 {
		m.Edge = m.Vol1mBps / roundTripBps
	}
	return m
}
