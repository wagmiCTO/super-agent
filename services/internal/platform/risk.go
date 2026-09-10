package platform

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/strategy"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
)

// The risk screen: one wallet, every strategy it has a key for, what each
// may lose and has lost, what is open right now and what guards it, and
// what the market costs against what it moves. Read-only except for one
// button, "close everything".

// riskStrategyDTO is one strategy's risk as the screen reads it.
type riskStrategyDTO struct {
	ID       string            `json:"id"`
	Name     string            `json:"name"`
	Enabled  bool              `json:"enabled"`
	Limits   *limitsDTO        `json:"limits,omitempty"`
	Usage    *riskUsageDTO     `json:"usage,omitempty"`
	Killed   bool              `json:"killed"`
	KillNote string            `json:"kill_note,omitempty"`
	Today    *perfDTO          `json:"today,omitempty"`
	Week     *perfDTO          `json:"week,omitempty"`
	All      *perfDTO          `json:"all,omitempty"`
	Open     []riskPositionDTO `json:"open"`
}

// riskUsageDTO is how much of each limit is spent right now.
type riskUsageDTO struct {
	Exposure      string  `json:"exposure"`
	ExposurePct   float64 `json:"exposure_pct"`
	OpenPositions int     `json:"open_positions"`
	DailyLoss     string  `json:"daily_loss"`
	DailyLossPct  float64 `json:"daily_loss_pct"`
	DailyLossLeft string  `json:"daily_loss_left"`
	// CooldownLeftSeconds is how long until the next opening is allowed.
	CooldownLeftSeconds float64 `json:"cooldown_left_seconds"`
}

type perfDTO struct {
	Trades      int            `json:"trades"`
	Wins        int            `json:"wins"`
	Losses      int            `json:"losses"`
	WinRate     float64        `json:"win_rate"`
	PnL         string         `json:"pnl"`
	Fees        string         `json:"fees"`
	Best        string         `json:"best"`
	Worst       string         `json:"worst"`
	AvgWin      string         `json:"avg_win"`
	AvgLoss     string         `json:"avg_loss"`
	MaxDrawdown string         `json:"max_drawdown"`
	AvgHoldSec  float64        `json:"avg_hold_seconds"`
	Streak      int            `json:"streak"`
	ByReason    map[string]int `json:"by_reason"`
}

type riskPositionDTO struct {
	positionDTO
	Strategy string `json:"strategy"`
	// LiquidationPrice is where the venue would liquidate, when it publishes
	// the leverage it liquidates at; absent otherwise.
	LiquidationPrice string `json:"liquidation_price,omitempty"`
	// DistanceToLiquidationPct is how far the mark may move against the
	// position before liquidation, in percent of the entry price.
	DistanceToLiquidationPct string `json:"distance_to_liquidation_pct,omitempty"`
	// AtRisk is what this position can still lose: to the stop when armed,
	// to the collateral otherwise.
	AtRisk string `json:"at_risk"`
}

type riskMarketDTO struct {
	Symbol       string  `json:"symbol"`
	Vol1mBps     float64 `json:"vol_1m_bps"`
	Range1mBps   float64 `json:"range_1m_bps"`
	RoundTripBps float64 `json:"round_trip_bps"`
	Edge         float64 `json:"edge"`
	Bars         int     `json:"bars"`
}

type riskReportDTO struct {
	Wallet     string            `json:"wallet"`
	Strategies []riskStrategyDTO `json:"strategies"`
	Open       []riskPositionDTO `json:"open"`
	Totals     struct {
		Exposure  string   `json:"exposure"`
		AtRisk    string   `json:"at_risk"`
		DailyLoss string   `json:"daily_loss"`
		Today     *perfDTO `json:"today,omitempty"`
		Week      *perfDTO `json:"week,omitempty"`
		All       *perfDTO `json:"all,omitempty"`
	} `json:"totals"`
	Market    []riskMarketDTO `json:"market"`
	UpdatedAt string          `json:"updated_at"`
}

func toPerfDTO(p PerfStats) *perfDTO {
	return &perfDTO{
		Trades: p.Trades, Wins: p.Wins, Losses: p.Losses, WinRate: p.WinRate(), PnL: p.PnL.String(), Fees: p.Fees.String(),
		Best: p.Best.String(), Worst: p.Worst.String(), AvgWin: p.AvgWin.String(), AvgLoss: p.AvgLoss.String(),
		MaxDrawdown: p.MaxDrawdown.String(), AvgHoldSec: p.AvgHold.Seconds(), Streak: p.Streak, ByReason: p.ByReason,
	}
}

func pct(part, whole fixed.D) float64 {
	if !whole.IsPos() {
		return 0
	}
	return part.Float64() / whole.Float64() * 100
}

// riskPosition turns a venue position into the screen's row, with the
// stop, the liquidation distance and what is still at risk.
func riskPosition(p venue.Position, st State, strategyID string, market *venue.Market) riskPositionDTO {
	base := positionDTO{
		ID: p.VenueID, Symbol: p.Symbol, Side: p.Side.String(), Size: p.Size.String(), EntryPrice: p.EntryPrice.String(),
		Notional: p.EntryPrice.Mul(p.Size).String(), Collateral: p.Collateral.String(), Leverage: p.Leverage.String(),
		UnrealizedPnL: p.UnrealizedPnL.String(), FeesPaid: p.FeesPaid.String(), OpenedAt: timeOrEmpty(p.OpenedAt),
		ClosesAt: timeOrEmpty(st.Deadlines[p.Symbol]),
	}
	out := riskPositionDTO{positionDTO: base, Strategy: strategyID}
	atRisk := p.Collateral
	if ml, ok := st.Stops[p.Symbol]; ok && ml.IsPos() {
		base.MaxLoss = ml.String()
		stopPnL := p.Collateral.Mul(ml).Neg()
		base.StopPnL = stopPnL.String()
		atRisk = p.Collateral.Mul(ml)
		out.positionDTO = base
	}
	// What can still be lost from here: the allowance minus what is already lost.
	if p.UnrealizedPnL.IsNeg() {
		atRisk = atRisk.Add(p.UnrealizedPnL)
		if atRisk.IsNeg() {
			atRisk = 0
		}
	}
	out.AtRisk = atRisk.String()
	if market != nil && market.LiquidationLeverage.IsPos() && p.EntryPrice.IsPos() && p.Leverage.IsPos() {
		// Liquidation when the loss reaches collateral × (leverage / liquidation leverage):
		// at liquidation leverage L_liq, the margin left is notional / L_liq.
		// Distance as a fraction of entry: 1/leverage − 1/L_liq.
		one := fixed.FromInt(1)
		dist := one.Div(p.Leverage).Sub(one.Div(market.LiquidationLeverage))
		if dist.IsPos() {
			var liq fixed.D
			if p.Side == venue.Long {
				liq = p.EntryPrice.Mul(one.Sub(dist))
			} else {
				liq = p.EntryPrice.Mul(one.Add(dist))
			}
			out.LiquidationPrice = liq.String()
			out.DistanceToLiquidationPct = dist.Mul(fixed.FromInt(100)).String()
		}
	}
	return out
}

// riskServices lists the services the request's wallet trades through,
// one per strategy it has a key for; a wallet-wide key is one service
// reported under every strategy, but read once.
func (h *handler) riskServices(ctx context.Context, w http.ResponseWriter, r *http.Request) (map[string]*Service, string, bool) {
	addr := strings.ToLower(strings.TrimSpace(r.Header.Get(AccountHeader)))
	out := make(map[string]*Service, len(strategy.Catalog))
	if addr == "" {
		if !h.ownAccount {
			writeJSON(w, http.StatusForbidden, errorDTO{Error: "own_account_disabled", Message: "this platform trades for enrolled wallets only — sign in with a passkey"})
			return nil, "", false
		}
		for _, s := range strategy.Catalog {
			out[s.ID] = h.svc
		}
		return out, h.svc.account, true
	}
	if h.registry == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorDTO{Error: "enrollment_unavailable", Message: "per-wallet trading is not enabled"})
		return nil, "", false
	}
	for _, s := range strategy.Catalog {
		svc, err := h.registry.Get(ctx, addr, s.ID)
		if err != nil {
			if errors.Is(err, ErrNoKey) {
				continue
			}
			h.fail(w, err)
			return nil, "", false
		}
		out[s.ID] = svc
	}
	return out, addr, true
}

// risk assembles the report.
func (h *handler) risk(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	services, wallet, ok := h.riskServices(ctx, w, r)
	if !ok {
		return
	}
	now := time.Now()
	out := riskReportDTO{Wallet: wallet, Strategies: []riskStrategyDTO{}, Open: []riskPositionDTO{}, Market: []riskMarketDTO{}, UpdatedAt: timeOrEmpty(now)}

	// Markets once, for liquidation leverage and fees.
	markets := map[string]venue.Market{}
	if ms, err := h.svc.Markets(ctx); err == nil {
		for _, m := range ms {
			markets[m.Symbol] = m
		}
	}
	states := map[*Service]State{}
	var exposure, atRisk, dailyLoss fixed.D
	var allToday, allWeek, allAll PerfStats
	seenPositions := map[string]bool{}
	for _, s := range strategy.Catalog {
		row := riskStrategyDTO{ID: s.ID, Name: s.Name, Open: []riskPositionDTO{}}
		svc := services[s.ID]
		if svc == nil {
			out.Strategies = append(out.Strategies, row)
			continue
		}
		row.Enabled = true
		st, seen := states[svc]
		if !seen {
			var err error
			if st, err = svc.State(ctx); err != nil {
				h.fail(w, err)
				return
			}
			states[svc] = st
		}
		lim := toStateDTO(st).Limits
		row.Limits = &lim
		var cooldownLeft float64
		if st.Limits.Cooldown > 0 && !st.Risk.LastOpen.IsZero() {
			if left := st.Limits.Cooldown - now.Sub(st.Risk.LastOpen); left > 0 {
				cooldownLeft = left.Seconds()
			}
		}
		left := st.Limits.DailyLoss.Sub(st.Risk.DailyLoss)
		if left.IsNeg() {
			left = 0
		}
		row.Usage = &riskUsageDTO{
			Exposure: st.Risk.Exposure.String(), ExposurePct: pct(st.Risk.Exposure, st.Limits.MaxTotalExposure),
			OpenPositions: st.Risk.OpenPositions, DailyLoss: st.Risk.DailyLoss.String(), DailyLossPct: pct(st.Risk.DailyLoss, st.Limits.DailyLoss),
			DailyLossLeft: left.String(), CooldownLeftSeconds: cooldownLeft,
		}
		row.Killed, row.KillNote = st.Killed, st.KillNote
		// A shared service counts its limits and positions once.
		if !seen {
			exposure = exposure.Add(st.Risk.Exposure)
			dailyLoss = dailyLoss.Add(st.Risk.DailyLoss)
		}
		trades, err := svc.Trades(ctx, "", s.ID, 500)
		if err == nil {
			today, week, all := Stats(trades, StartOfDay(now)), Stats(trades, StartOfWeek(now)), Stats(trades, time.Time{})
			row.Today, row.Week, row.All = toPerfDTO(today), toPerfDTO(week), toPerfDTO(all)
			allToday, allWeek, allAll = mergeStats(allToday, today), mergeStats(allWeek, week), mergeStats(allAll, all)
		}
		for _, p := range st.Positions {
			var m *venue.Market
			if mk, ok := markets[p.Symbol]; ok {
				m = &mk
			}
			rp := riskPosition(p, st, s.ID, m)
			row.Open = append(row.Open, rp)
			key := p.VenueID + "/" + p.Symbol
			if !seenPositions[key] {
				seenPositions[key] = true
				out.Open = append(out.Open, rp)
				if v, err := fixed.Parse(rp.AtRisk); err == nil {
					atRisk = atRisk.Add(v)
				}
			}
		}
		out.Strategies = append(out.Strategies, row)
	}
	out.Totals.Exposure, out.Totals.AtRisk, out.Totals.DailyLoss = exposure.String(), atRisk.String(), dailyLoss.String()
	out.Totals.Today, out.Totals.Week, out.Totals.All = toPerfDTO(allToday), toPerfDTO(allWeek), toPerfDTO(allAll)

	// The market's own risk, for every market the platform allows.
	allowed := map[string]bool{}
	if lim, ok := h.svc.policy.Limits(h.svc.account); ok {
		for _, sym := range lim.AllowedSymbols {
			allowed[sym] = true
		}
	}
	for _, m := range markets {
		if len(allowed) > 0 && !allowed[m.Symbol] {
			continue
		}
		to := now.Truncate(time.Minute)
		candles, err := h.svc.Candles(ctx, m.Symbol, time.Minute, to.Add(-61*time.Minute), to)
		if err != nil {
			continue
		}
		var closed []venue.Candle
		for _, c := range candles {
			if c.Closed(now) {
				closed = append(closed, c)
			}
		}
		rt := m.Fees.RoundTripRate(false, false).Float64() * 1e4
		v := Volatility(m.Symbol, closed, rt)
		out.Market = append(out.Market, riskMarketDTO{Symbol: v.Symbol, Vol1mBps: v.Vol1mBps, Range1mBps: v.Range1mBps, RoundTripBps: v.RoundTripBps, Edge: v.Edge, Bars: v.Bars})
	}
	writeJSON(w, http.StatusOK, out)
}

// mergeStats adds b into a; the streak and averages are per run and are
// dropped in the sum (the totals show counts, sums and extremes).
func mergeStats(a, b PerfStats) PerfStats {
	if a.ByReason == nil {
		a.ByReason = map[string]int{}
	}
	if a.Trades == 0 {
		b.Streak = 0
		return b
	}
	a.Trades += b.Trades
	a.Wins += b.Wins
	a.Losses += b.Losses
	a.PnL = a.PnL.Add(b.PnL)
	a.Fees = a.Fees.Add(b.Fees)
	if b.Best.Cmp(a.Best) > 0 {
		a.Best = b.Best
	}
	if b.Worst.Cmp(a.Worst) < 0 {
		a.Worst = b.Worst
	}
	if b.MaxDrawdown.Cmp(a.MaxDrawdown) > 0 {
		a.MaxDrawdown = b.MaxDrawdown
	}
	for k, v := range b.ByReason {
		a.ByReason[k] += v
	}
	a.AvgWin, a.AvgLoss, a.AvgHold, a.Streak = 0, 0, 0, 0
	return a
}

type closeAllResultDTO struct {
	Strategy string `json:"strategy"`
	Symbol   string `json:"symbol"`
	Closed   bool   `json:"closed"`
	Error    string `json:"error,omitempty"`
	PnL      string `json:"pnl,omitempty"`
}

// closeAll flattens every open position the wallet has, across strategies.
// Each close goes through the one close path; one failure does not stop
// the rest, and every outcome is reported.
func (h *handler) closeAll(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	services, _, ok := h.riskServices(ctx, w, r)
	if !ok {
		return
	}
	out := []closeAllResultDTO{}
	done := map[*Service]bool{}
	for _, s := range strategy.Catalog {
		svc := services[s.ID]
		if svc == nil || done[svc] {
			continue
		}
		done[svc] = true
		st, err := svc.State(ctx)
		if err != nil {
			out = append(out, closeAllResultDTO{Strategy: s.ID, Error: err.Error()})
			continue
		}
		for _, p := range st.Positions {
			res := closeAllResultDTO{Strategy: s.ID, Symbol: p.Symbol}
			order, err := svc.Close(ctx, CloseRequest{Symbol: p.Symbol})
			switch {
			case err != nil:
				res.Error = err.Error()
			case order.Status == venue.StatusFailed:
				res.Error = "the exchange refused the close"
			default:
				res.Closed = true
				if ev := svc.lastCloseEvent(); ev != nil && ev.Symbol == p.Symbol {
					res.PnL = ev.PnL.String()
				}
			}
			out = append(out, res)
		}
	}
	h.log.Warn("close everything", "wallet", strings.ToLower(r.Header.Get(AccountHeader)), "results", len(out))
	writeJSON(w, http.StatusOK, map[string]any{"closed": countClosed(out), "results": out})
}

func countClosed(rs []closeAllResultDTO) int {
	n := 0
	for _, r := range rs {
		if r.Closed {
			n++
		}
	}
	return n
}

// lastCloseEvent is the most recent close, for the close-all report.
func (s *Service) lastCloseEvent() *CloseEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.lastClose == nil {
		return nil
	}
	ev := *s.lastClose
	return &ev
}
