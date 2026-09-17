// Package platform is the trading service the app talks to.
//
// It owns the one path an order can take: request → policy engine → venue.
// Nothing above it places orders, and nothing in it reaches the venue without
// passing the policy check first. HTTP is a thin layer on top (see http.go);
// this file has no knowledge of it.
package platform

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/policy"
	"github.com/wagmiCTO/super-agent/services/internal/store"
	"github.com/wagmiCTO/super-agent/services/internal/strategy"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
)

// Errors the service returns for conditions the API maps to distinct statuses.
var (
	ErrInvalid    = errors.New("platform: invalid request")
	ErrNoPosition = errors.New("platform: no open position")
)

// OpenRequest is what the app sends to take a position. Rules are the exit
// the user chose along with the entry: the horizon that closes the position
// for them.
type OpenRequest struct {
	Symbol   string
	Side     venue.Side
	Notional fixed.D
	Leverage fixed.D
	Rules    strategy.Rules
	// Strategy tags the round trip for the leaderboard; empty means the
	// default strategy.
	Strategy string
	// TakeProfit is the target: the fraction of the position's collateral it
	// may make before the platform closes it and banks the result. Zero
	// leaves the win to the horizon.
	TakeProfit fixed.D
	// MaxLoss is the stop: the fraction of the position's collateral it may
	// lose before the platform closes it. Zero means no stop — the horizon,
	// or the venue's liquidation, is the only exit.
	MaxLoss fixed.D
}

// CloseReason says who closed a position.
type CloseReason string

const (
	CloseManual  CloseReason = "manual"
	CloseHorizon CloseReason = "horizon"
	// CloseStop is the platform closing a position that lost its allowance.
	CloseStop CloseReason = "stop"
	// CloseTakeProfit is the platform closing a position that made its target.
	CloseTakeProfit CloseReason = "take_profit"
)

// defaultStopEvery is how often an armed stop reads the position's mark.
const defaultStopEvery = 3 * time.Second

// CloseEvent is the last round trip's outcome, kept so the screen can tell
// the user their position was closed while they were not looking.
type CloseEvent struct {
	Symbol string
	Side   venue.Side
	Reason CloseReason
	Price  fixed.D
	PnL    fixed.D
	At     time.Time
}

// CloseRequest closes the open position in a market.
type CloseRequest struct {
	Symbol string
}

// AmendRequest changes a running position's exits without touching the
// position itself: the stop, the target, and how long it has left. A set
// pointer replaces that exit (zero disarms it); nil leaves it as it is.
type AmendRequest struct {
	Symbol     string
	MaxLoss    *fixed.D
	TakeProfit *fixed.D
	// Extend pushes the horizon this much further out; a position without
	// one gets one this long from now. Zero leaves the timer alone.
	Extend time.Duration
}

// Amended is a position's exits as they stand after an amendment.
type Amended struct {
	Symbol string
	// ClosesAt is zero while no horizon is armed.
	ClosesAt   time.Time
	MaxLoss    fixed.D
	TakeProfit fixed.D
}

// Service is the trading core. One instance serves one exchange account; the
// per-user layer arrives with the account layer and sits above this.
type Service struct {
	venue  venue.Adapter
	policy *policy.Engine
	// account is what the policy engine and the horizons are keyed by:
	// the wallet, or "<wallet>/<strategy>" for a strategy's own key.
	account string
	// wallet is the address behind that account — what the board, the
	// journal and the prize contract know it by.
	wallet string
	log    *slog.Logger
	timers *strategy.Timers
	now    func() time.Time
	// ledger is shared across wallets; nil keeps no leaderboard.
	ledger *Ledger
	// store, when set, keeps pending horizons across restarts.
	store *store.Store

	mu        sync.Mutex
	lastClose *CloseEvent
	stops     map[string]*stop // armed stops by symbol; guarded by mu
	// runs is how far each open position has gone each way, by symbol.
	runs      map[string]*excursion
	stopEvery time.Duration // zero means defaultStopEvery

	// limitsFn, when set, recomputes the limits from the balance before
	// every read and every opening order — the daily budget is a share of
	// the balance, so it cannot be set once at connect. balance is the last
	// one read, so an order does not pay for a second venue round trip.
	limitsFn     func(ctx context.Context, balance, lossToday fixed.D) policy.Limits
	balance      fixed.D
	balanceKnown bool
}

// New wires the service and reconciles the policy engine against the venue's
// own view of open positions. That reconciliation is not optional: after a
// restart, the exchange is the source of truth and our memory is not.
//
// accountKey identifies the account to the policy engine. It is the wallet
// address where one is known, because the venue's own account id is 0 for a
// wallet that has not yet created an exchange account and must not make two
// such wallets share limits.
func New(ctx context.Context, v venue.Adapter, p *policy.Engine, accountKey string, limits policy.Limits, log *slog.Logger) (*Service, error) {
	if log == nil {
		log = slog.Default()
	}
	if accountKey == "" {
		return nil, errors.New("platform: an account key is required")
	}
	if _, err := v.Account(ctx); err != nil {
		return nil, fmt.Errorf("platform: read account: %w", err)
	}
	if err := p.SetLimits(accountKey, limits); err != nil {
		return nil, err
	}
	s := &Service{venue: v, policy: p, account: accountKey, wallet: walletOf(accountKey), log: log, timers: strategy.NewTimers(), now: time.Now}
	if err := s.reconcile(ctx); err != nil {
		return nil, err
	}
	return s, nil
}

// UseLedger records this service's round trips on a shared ledger.
func (s *Service) UseLedger(l *Ledger) { s.ledger = l }

// Restore attaches durable storage and re-arms the horizons it holds for
// this account. A horizon already past is closed now.
func (s *Service) Restore(ctx context.Context, st *store.Store) error {
	s.store = st
	hs, err := st.Horizons(ctx, s.account)
	if err != nil {
		return fmt.Errorf("platform: restore horizons: %w", err)
	}
	// What a strategy's own key journaled before ADR 0007 belongs to this
	// wallet now: a position open across that deploy still closes on time.
	if s.account == s.wallet {
		for _, info := range strategy.Catalog {
			old, err := st.Horizons(ctx, legacyPolicyAccount(s.wallet, info.ID))
			if err != nil {
				return fmt.Errorf("platform: restore horizons: %w", err)
			}
			hs = append(hs, old...)
		}
	}
	for _, h := range hs {
		symbol := h.Symbol
		if !h.ClosesAt.IsZero() {
			s.timers.Schedule(symbol, h.ClosesAt, func() { s.closeOnHorizon(symbol) })
		}
		if h.MaxLoss.IsPos() || h.TakeProfit.IsPos() {
			s.armStop(symbol, h.MaxLoss, h.TakeProfit)
		}
		s.log.Info("horizon restored", "symbol", symbol, "closes_at", h.ClosesAt, "max_loss", h.MaxLoss, "take_profit", h.TakeProfit)
	}
	return nil
}

// Shutdown releases the service's timers. Positions stay as they are on
// the venue; a horizon pending at shutdown is lost — see the strategy ADR.
func (s *Service) Shutdown() { s.timers.Close() }

func (s *Service) reconcile(ctx context.Context) error {
	positions, err := s.venue.Positions(ctx)
	if err != nil {
		return fmt.Errorf("platform: reconcile positions: %w", err)
	}
	s.policy.Reconcile(s.account, positions)
	s.log.Info("reconciled against venue", "venue", s.venue.Name(), "account", s.account, "open_positions", len(positions))
	return nil
}

// Markets lists what can be traded, with the fee schedule that applies.
func (s *Service) Markets(ctx context.Context) ([]venue.Market, error) {
	return s.venue.Markets(ctx)
}

// Candles serves closed bars for the chart; the caller bounds the range.
func (s *Service) Candles(ctx context.Context, symbol string, period time.Duration, from, to time.Time) ([]venue.Candle, error) {
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	if symbol == "" {
		return nil, fmt.Errorf("%w: symbol is required", ErrInvalid)
	}
	if period <= 0 || to.Before(from) {
		return nil, fmt.Errorf("%w: period must be positive and from <= to", ErrInvalid)
	}
	return s.venue.Candles(ctx, symbol, period, from, to)
}

// State is everything the app needs to render the account.
type State struct {
	Venue     string
	Account   venue.Account
	Positions []venue.Position
	// Deadlines is when each position's horizon closes it, by symbol.
	Deadlines map[string]time.Time
	// Stops is each position's armed stop, by symbol: the fraction of
	// collateral it may lose.
	Stops map[string]fixed.D
	// TakeProfits is each position's armed target, by symbol: the fraction
	// of collateral it closes at once made.
	TakeProfits map[string]fixed.D
	LastClose   *CloseEvent
	Limits      policy.Limits
	Risk        policy.Snapshot
	Killed      bool
	KillNote    string
}

// UseLimits makes the limits follow the balance: fn is asked before every
// read and every opening order, with the balance and what the day has lost.
func (s *Service) UseLimits(fn func(ctx context.Context, balance, lossToday fixed.D) policy.Limits) {
	s.mu.Lock()
	s.limitsFn = fn
	s.mu.Unlock()
}

// refreshLimits recomputes the limits from a balance just read.
func (s *Service) refreshLimits(ctx context.Context, balance fixed.D) {
	s.mu.Lock()
	fn := s.limitsFn
	s.balance, s.balanceKnown = balance, true
	s.mu.Unlock()
	if fn == nil {
		return
	}
	loss := s.policy.Snapshot(s.account).DailyLoss
	if err := s.policy.SetLimits(s.account, fn(ctx, balance, loss)); err != nil {
		s.log.Warn("limits not refreshed", "err", err)
	}
}

// refreshLimitsForOrder does the same before an opening order, reading the
// balance only when no read has happened yet.
func (s *Service) refreshLimitsForOrder(ctx context.Context) {
	s.mu.Lock()
	fn, balance, known := s.limitsFn, s.balance, s.balanceKnown
	s.mu.Unlock()
	if fn == nil {
		return
	}
	if !known {
		acct, err := s.venue.Account(ctx)
		if err != nil {
			s.log.Warn("balance not read before order; limits stay as they were", "err", err)
			return
		}
		balance = acct.Balance
	}
	s.refreshLimits(ctx, balance)
}

// State returns balance, open positions, the limits in force and how much of
// them is used.
func (s *Service) State(ctx context.Context) (State, error) {
	acct, err := s.venue.Account(ctx)
	if err != nil {
		return State{}, err
	}
	positions, err := s.venue.Positions(ctx)
	if err != nil {
		return State{}, err
	}
	s.refreshLimits(ctx, acct.Balance)
	limits, _ := s.policy.Limits(s.account)
	killed, note := s.policy.Killed()
	deadlines := make(map[string]time.Time, len(positions))
	stops := make(map[string]fixed.D, len(positions))
	targets := make(map[string]fixed.D, len(positions))
	for _, p := range positions {
		if at, ok := s.timers.Deadline(p.Symbol); ok {
			deadlines[p.Symbol] = at
		}
		if g, ok := s.stopFor(p.Symbol); ok {
			if g.maxLoss.IsPos() {
				stops[p.Symbol] = g.maxLoss
			}
			if g.takeProfit.IsPos() {
				targets[p.Symbol] = g.takeProfit
			}
		}
		// Every read is also a reading: how far the position has run each
		// way is sampled here and by the stop watcher, and journaled when
		// it closes.
		s.noteExcursion(p.Symbol, p.UnrealizedPnL)
	}
	s.mu.Lock()
	last := s.lastClose
	s.mu.Unlock()
	return State{
		Venue:       s.venue.Name(),
		Account:     acct,
		Positions:   positions,
		Deadlines:   deadlines,
		Stops:       stops,
		TakeProfits: targets,
		LastClose:   last,
		Limits:      limits,
		Risk:        s.policy.Snapshot(s.account),
		Killed:      killed,
		KillNote:    note,
	}, nil
}

// Open takes a position. The policy check runs before the venue is touched,
// and the engine is told about the open only after the venue accepted it — a
// refused order must not consume a cooldown or an exposure slot.
func (s *Service) Open(ctx context.Context, req OpenRequest) (venue.Order, error) {
	req.Symbol = strings.ToUpper(strings.TrimSpace(req.Symbol))
	if req.Symbol == "" {
		return venue.Order{}, fmt.Errorf("%w: symbol is required", ErrInvalid)
	}
	if req.Side != venue.Long && req.Side != venue.Short {
		return venue.Order{}, fmt.Errorf("%w: side must be long or short", ErrInvalid)
	}
	if !req.Notional.IsPos() {
		return venue.Order{}, fmt.Errorf("%w: notional must be positive", ErrInvalid)
	}
	if req.MaxLoss.IsNeg() || req.MaxLoss.Cmp(fixed.FromInt(1)) > 0 {
		return venue.Order{}, fmt.Errorf("%w: max_loss must be between 0 and 1", ErrInvalid)
	}
	if req.TakeProfit.IsNeg() {
		return venue.Order{}, fmt.Errorf("%w: take_profit must not be negative", ErrInvalid)
	}
	if req.Leverage.IsZero() {
		req.Leverage = fixed.FromInt(1)
	}
	if !req.Leverage.IsPos() {
		return venue.Order{}, fmt.Errorf("%w: leverage must be positive", ErrInvalid)
	}
	if err := req.Rules.Validate(); err != nil {
		return venue.Order{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	if req.Strategy == "" {
		req.Strategy = strategy.DefaultStrategy
	}
	if !strategy.Known(req.Strategy) {
		return venue.Order{}, fmt.Errorf("%w: unknown strategy %q", ErrInvalid, req.Strategy)
	}
	// The strategy's own cap from the catalog, by the strategy the order
	// names (ADR 0007): the one per-strategy limit there is.
	if info, ok := strategy.Lookup(req.Strategy); ok && info.NotionalCap != "" {
		if cap, err := fixed.Parse(info.NotionalCap); err == nil && cap.IsPos() && req.Notional.Cmp(cap) > 0 {
			return venue.Order{}, fmt.Errorf("%w: %s allows at most %s per position", ErrInvalid, info.Name, cap)
		}
	}

	order := venue.OrderRequest{
		ClientID: newClientID("open"),
		Symbol:   req.Symbol,
		Side:     req.Side,
		Notional: req.Notional,
		Leverage: req.Leverage,
	}
	s.refreshLimitsForOrder(ctx)
	if err := s.policy.Authorize(policy.FromOrder(s.account, order)); err != nil {
		return venue.Order{}, err
	}

	placed, err := s.venue.Place(ctx, order)
	if err != nil {
		return venue.Order{}, err
	}
	if placed.Status == venue.StatusFailed {
		// The venue refused after admission; nothing was opened.
		return placed, nil
	}
	// Record what actually opened, not what was asked: lot rounding makes
	// the filled notional differ from the request by a few cents.
	opened := req.Notional
	if placed.FilledSize > 0 && placed.AvgPrice > 0 {
		opened = placed.AvgPrice.Mul(placed.FilledSize)
	}
	s.policy.RecordOpen(s.account, opened)
	if s.ledger != nil {
		s.ledger.Opened(s.account, s.wallet, req.Strategy, req.Symbol, placed.VenueID,
			store.Fill{Side: req.Side.String(), Size: placed.FilledSize, Price: placed.AvgPrice, Fee: placed.Fee, BuilderFee: placed.BuilderFee}, termsOf(opened, req.Leverage, req.MaxLoss, req.TakeProfit))
	}
	var closesAt time.Time
	if req.Rules.Horizon > 0 {
		// The exit is armed the moment the entry is confirmed. It fires on
		// its own goroutine and goes through the same Close as a tap would.
		symbol := req.Symbol
		closesAt = s.now().Add(req.Rules.Horizon)
		s.timers.Schedule(symbol, closesAt, func() { s.closeOnHorizon(symbol) })
	}
	if req.MaxLoss.IsPos() || req.TakeProfit.IsPos() {
		s.armStop(req.Symbol, req.MaxLoss, req.TakeProfit)
	}
	if s.store != nil && (req.Rules.Horizon > 0 || req.MaxLoss.IsPos() || req.TakeProfit.IsPos()) {
		if err := s.store.SaveHorizon(ctx, store.Horizon{Account: s.account, Symbol: req.Symbol, ClosesAt: closesAt, MaxLoss: req.MaxLoss, TakeProfit: req.TakeProfit}); err != nil {
			s.log.Warn("horizon not persisted", "symbol", req.Symbol, "err", err)
		}
	}
	s.log.Info("opened", "symbol", req.Symbol, "side", req.Side, "notional", req.Notional,
		"leverage", req.Leverage, "horizon", req.Rules.Horizon, "max_loss", req.MaxLoss, "take_profit", req.TakeProfit, "strategy", req.Strategy, "order", placed.VenueID, "status", placed.Status, "fee", placed.Fee)
	return placed, nil
}

// armStop watches a position and closes it once its unrealized result
// reaches either bound: a loss of maxLoss of its collateral, or a gain of
// takeProfit of it. Zero on either side means no bound there. One watcher
// per symbol; arming again replaces it. It reads the venue's own mark, so
// the stop is the venue's number, not a price the app guessed.
func (s *Service) armStop(symbol string, maxLoss, takeProfit fixed.D) {
	s.mu.Lock()
	if s.stops == nil {
		s.stops = make(map[string]*stop)
	}
	if old := s.stops[symbol]; old != nil {
		close(old.done)
	}
	st := &stop{maxLoss: maxLoss, takeProfit: takeProfit, done: make(chan struct{})}
	s.stops[symbol] = st
	s.mu.Unlock()
	go s.watchStop(symbol, st)
}

// stop is the pair of bounds a watcher guards, as fractions of collateral.
type stop struct {
	maxLoss    fixed.D
	takeProfit fixed.D
	done       chan struct{}
}

func (s *Service) stopFor(symbol string) (stop, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.stops[symbol]
	if st == nil {
		return stop{}, false
	}
	return *st, true
}

// disarmStop forgets a symbol's stop; the close path calls it so a tap or
// a horizon does not race the stop into a second close.
func (s *Service) disarmStop(symbol string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if st := s.stops[symbol]; st != nil {
		close(st.done)
		delete(s.stops, symbol)
	}
}

func (s *Service) watchStop(symbol string, st *stop) {
	every := s.stopEvery
	if every <= 0 {
		every = defaultStopEvery
	}
	tick := time.NewTicker(every)
	defer tick.Stop()
	for {
		select {
		case <-st.done:
			return
		case <-tick.C:
		}
		ctx, cancel := context.WithTimeout(context.Background(), defaultStopEvery)
		positions, err := s.venue.Positions(ctx)
		cancel()
		if err != nil {
			continue
		}
		var pos *venue.Position
		for i := range positions {
			if positions[i].Symbol == symbol {
				pos = &positions[i]
				break
			}
		}
		if pos == nil {
			// Gone by another exit: nothing left to guard.
			s.disarmStop(symbol)
			return
		}
		s.noteExcursion(symbol, pos.UnrealizedPnL)
		var reason CloseReason
		allowance := pos.Collateral.Mul(st.maxLoss)
		target := pos.Collateral.Mul(st.takeProfit)
		switch {
		case allowance.IsPos() && pos.UnrealizedPnL.Neg().Cmp(allowance) >= 0:
			reason = CloseStop
			s.log.Warn("stop hit", "symbol", symbol, "unrealized", pos.UnrealizedPnL, "allowance", allowance.Neg())
		case target.IsPos() && pos.UnrealizedPnL.Cmp(target) >= 0:
			reason = CloseTakeProfit
			s.log.Info("take profit hit", "symbol", symbol, "unrealized", pos.UnrealizedPnL, "target", target)
		default:
			continue
		}
		for attempt := 1; attempt <= horizonCloseAttempts; attempt++ {
			ctx, cancel := context.WithTimeout(context.Background(), horizonCloseTimeout)
			_, err := s.close(ctx, symbol, reason)
			cancel()
			if err == nil || errors.Is(err, ErrNoPosition) {
				return
			}
			s.log.Warn("guard close failed", "symbol", symbol, "reason", reason, "attempt", attempt, "err", err)
			time.Sleep(time.Second)
		}
		s.log.Error("guard close gave up", "symbol", symbol, "reason", reason)
		return
	}
}

// closeOnHorizon is the horizon timer's callback. Closing must not depend on
// anything transient, so it retries a few times before giving up loudly; a
// position that is already gone (closed by hand, liquidated) is not an error.
func (s *Service) closeOnHorizon(symbol string) {
	for attempt := 1; attempt <= horizonCloseAttempts; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), horizonCloseTimeout)
		_, err := s.close(ctx, symbol, CloseHorizon)
		cancel()
		switch {
		case err == nil, errors.Is(err, ErrNoPosition):
			return
		case attempt < horizonCloseAttempts:
			s.log.Warn("horizon close failed, retrying", "symbol", symbol, "attempt", attempt, "err", err)
			time.Sleep(horizonCloseRetry)
		default:
			s.log.Error("horizon close failed; position left open", "symbol", symbol, "err", err)
		}
	}
}

const (
	horizonCloseAttempts = 3
	horizonCloseTimeout  = 30 * time.Second
	horizonCloseRetry    = 5 * time.Second
)

// Amend re-arms a running position's exits. Nothing is placed at the
// venue: the stop and the target are the platform's own watch on the
// venue's mark, and the horizon is the platform's timer, so an amendment
// is the same guards armed again with the new numbers. It goes through no
// policy check because it opens nothing; the exits it sets are the ones
// every open already gets.
func (s *Service) Amend(ctx context.Context, req AmendRequest) (Amended, error) {
	symbol := strings.ToUpper(strings.TrimSpace(req.Symbol))
	if symbol == "" {
		return Amended{}, fmt.Errorf("%w: symbol is required", ErrInvalid)
	}
	if req.MaxLoss != nil && (req.MaxLoss.IsNeg() || req.MaxLoss.Cmp(fixed.FromInt(1)) > 0) {
		return Amended{}, fmt.Errorf("%w: max_loss must be between 0 and 1", ErrInvalid)
	}
	if req.TakeProfit != nil && req.TakeProfit.IsNeg() {
		return Amended{}, fmt.Errorf("%w: take_profit must not be negative", ErrInvalid)
	}
	if req.Extend < 0 {
		return Amended{}, fmt.Errorf("%w: extend must not be negative", ErrInvalid)
	}
	positions, err := s.venue.Positions(ctx)
	if err != nil {
		return Amended{}, err
	}
	var pos *venue.Position
	for i := range positions {
		if positions[i].Symbol == symbol {
			pos = &positions[i]
			break
		}
	}
	if pos == nil {
		return Amended{}, fmt.Errorf("%w in %s", ErrNoPosition, symbol)
	}

	// The exits as they stand, with the requested ones written over them.
	current, _ := s.stopFor(symbol)
	maxLoss, takeProfit := current.maxLoss, current.takeProfit
	if req.MaxLoss != nil {
		maxLoss = *req.MaxLoss
	}
	if req.TakeProfit != nil {
		takeProfit = *req.TakeProfit
	}
	closesAt, hasHorizon := s.timers.Deadline(symbol)
	if req.Extend > 0 {
		now := s.now()
		from := now
		if hasHorizon && closesAt.After(now) {
			from = closesAt
		}
		closesAt = from.Add(req.Extend)
		if left := closesAt.Sub(now); left > strategy.MaxHorizon {
			return Amended{}, fmt.Errorf("%w: the position would run %s from now; the most is %s", ErrInvalid, left.Round(time.Minute), strategy.MaxHorizon)
		}
		s.timers.Schedule(symbol, closesAt, func() { s.closeOnHorizon(symbol) })
		hasHorizon = true
	}
	if maxLoss.IsPos() || takeProfit.IsPos() {
		s.armStop(symbol, maxLoss, takeProfit)
	} else {
		s.disarmStop(symbol)
	}
	if s.store != nil {
		var err error
		if hasHorizon || maxLoss.IsPos() || takeProfit.IsPos() {
			h := store.Horizon{Account: s.account, Symbol: symbol, MaxLoss: maxLoss, TakeProfit: takeProfit}
			if hasHorizon {
				h.ClosesAt = closesAt
			}
			err = s.store.SaveHorizon(ctx, h)
		} else {
			err = s.store.DeleteHorizon(ctx, s.account, symbol)
		}
		if err != nil {
			s.log.Warn("amendment not persisted", "symbol", symbol, "err", err)
		}
	}
	out := Amended{Symbol: symbol, MaxLoss: maxLoss, TakeProfit: takeProfit}
	if hasHorizon {
		out.ClosesAt = closesAt
	}
	s.log.Info("amended", "symbol", symbol, "max_loss", maxLoss, "take_profit", takeProfit, "closes_at", out.ClosesAt, "extend", req.Extend)
	return out, nil
}

// Close flattens the open position in a market. It sizes the order from the
// venue's position, not from anything the caller sends: a close that could be
// partial or oversized is a way to end up with the opposite exposure.
func (s *Service) Close(ctx context.Context, req CloseRequest) (venue.Order, error) {
	symbol := strings.ToUpper(strings.TrimSpace(req.Symbol))
	if symbol == "" {
		return venue.Order{}, fmt.Errorf("%w: symbol is required", ErrInvalid)
	}
	return s.close(ctx, symbol, CloseManual)
}

// close is the one exit, whoever asks for it. A pending horizon for the
// symbol is disarmed first: the tap and the timer must not race to close
// twice, which on a venue would mean opening the opposite side.
func (s *Service) close(ctx context.Context, symbol string, reason CloseReason) (venue.Order, error) {
	s.timers.Cancel(symbol)
	s.disarmStop(symbol)
	if s.store != nil {
		if err := s.store.DeleteHorizon(ctx, s.account, symbol); err != nil {
			s.log.Warn("horizon not cleared", "symbol", symbol, "err", err)
		}
	}

	positions, err := s.venue.Positions(ctx)
	if err != nil {
		return venue.Order{}, err
	}
	var pos *venue.Position
	for i := range positions {
		if positions[i].Symbol == symbol {
			pos = &positions[i]
			break
		}
	}
	if pos == nil {
		return venue.Order{}, fmt.Errorf("%w in %s", ErrNoPosition, symbol)
	}

	order := venue.OrderRequest{
		ClientID: newClientID("close"),
		Symbol:   symbol,
		Side:     pos.Side,
		Reduce:   true,
		Size:     pos.Size,
		Leverage: pos.Leverage,
	}
	// Closing is never refused, but it still goes through the engine so that
	// there is exactly one path an order can take.
	if err := s.policy.Authorize(policy.FromOrder(s.account, order)); err != nil {
		return venue.Order{}, err
	}

	placed, err := s.venue.Place(ctx, order)
	if err != nil {
		return venue.Order{}, err
	}
	if placed.Status == venue.StatusFailed {
		return placed, nil
	}

	notional := pos.EntryPrice.Mul(pos.Size)
	pnl := realizedPnL(*pos, placed)
	s.policy.RecordClose(s.account, notional, pnl)
	if s.ledger != nil {
		s.ledger.Closed(s.account, s.wallet, symbol, pnl, placed.VenueID,
			store.Fill{Side: pos.Side.String(), Size: placed.FilledSize, Price: placed.AvgPrice, Fee: placed.Fee, BuilderFee: placed.BuilderFee}, string(reason), s.takeExcursion(symbol))
	}
	s.mu.Lock()
	s.lastClose = &CloseEvent{Symbol: symbol, Side: pos.Side, Reason: reason, Price: placed.AvgPrice, PnL: pnl, At: s.now()}
	s.mu.Unlock()
	s.log.Info("closed", "symbol", symbol, "side", pos.Side, "size", pos.Size, "reason", reason,
		"entry", pos.EntryPrice, "exit", placed.AvgPrice, "pnl", pnl, "fee", placed.Fee)
	return placed, nil
}

// Trades lists this account's round trips in a symbol, newest first; an
// empty strategy means all of them.
func (s *Service) Trades(ctx context.Context, symbol, strategyID string, limit int) ([]store.ClosedTrade, error) {
	if s.ledger == nil {
		return nil, nil
	}
	return s.ledger.Trades(ctx, s.wallet, strings.ToUpper(strings.TrimSpace(symbol)), strings.TrimSpace(strategyID), limit)
}

// TradesPage is Trades one page at a time, newest first, with where the
// next page starts.
func (s *Service) TradesPage(ctx context.Context, q store.TradeQuery) ([]store.ClosedTrade, store.TradeCursor, error) {
	if s.ledger == nil {
		return nil, store.TradeCursor{}, nil
	}
	q.Wallet = s.wallet
	q.Symbol, q.Strategy = strings.ToUpper(strings.TrimSpace(q.Symbol)), strings.TrimSpace(q.Strategy)
	return s.ledger.TradesPage(ctx, q)
}

// Trade reads one of this wallet's round trips by its id.
func (s *Service) Trade(ctx context.Context, id int64) (store.ClosedTrade, bool, error) {
	if s.ledger == nil {
		return store.ClosedTrade{}, false, nil
	}
	return s.ledger.Trade(ctx, s.wallet, id)
}

// Kill halts opening across the service; Revive lifts it.
func (s *Service) Kill(reason string) { s.policy.Kill(reason) }
func (s *Service) Revive()            { s.policy.Revive() }

// realizedPnL is what the round trip did to the balance: the price move on
// the size that closed, minus every fee the position paid — the opening fee
// the venue already took and whatever the close was charged. The venue settles
// the exact number on the position event; this is what the daily loss limit
// sees immediately, and it must match the balance delta rather than flatter it.
func realizedPnL(pos venue.Position, closed venue.Order) fixed.D {
	fees := pos.FeesPaid.Add(closed.Fee)
	if !closed.AvgPrice.IsPos() || !closed.FilledSize.IsPos() {
		return fees.Neg()
	}
	move := closed.AvgPrice.Sub(pos.EntryPrice)
	if pos.Side == venue.Short {
		move = move.Neg()
	}
	return move.Mul(closed.FilledSize).Sub(fees)
}

// newClientID is the idempotency key handed to the venue. It is random rather
// than sequential so two service instances can never collide.
func newClientID(kind string) string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("%s-%d", kind, time.Now().UnixNano())
	}
	return kind + "-" + hex.EncodeToString(b[:])
}

// walletOf is the address inside a policy account: the account itself for a
// wallet-wide key, the part before the slash for a strategy's own key. What
// the board and the prize contract need is the address — a round trip
// journaled under "<wallet>/<strategy>" belongs to nobody who can claim.
func walletOf(account string) string {
	wallet, _, _ := strings.Cut(account, "/")
	return wallet
}

// termsOf is what a position was made of, for the journal: the wallet's own
// money in it, the leverage on top, and where the stop stood in money. The
// stop and target come in as shares of the collateral, which is how the
// policy judges them; what the report needs is the loss and the gain they
// close at.
func termsOf(notional, leverage, maxLoss, takeProfit fixed.D) store.Terms {
	var t store.Terms
	if leverage.IsPos() {
		lev := leverage
		t.Leverage = &lev
		if notional.IsPos() {
			collateral := notional.Div(leverage)
			t.Collateral = &collateral
			if maxLoss.IsPos() {
				stop := collateral.Mul(maxLoss).Neg()
				t.StopPnL = &stop
			}
			if takeProfit.IsPos() {
				tp := collateral.Mul(takeProfit)
				t.TakeProfitPnL = &tp
			}
		}
	}
	return t
}

// excursion is how far an open position has run each way, as the platform
// has seen it: the worst and the best its unrealized result was worth.
//
// Sampled, not continuous: the stop watcher reads the venue every few
// seconds while a stop is armed, and every state the app asks for adds a
// reading. A position nobody watched has none, and the card says so rather
// than drawing a zero.
type excursion struct{ worst, best fixed.D }

// noteExcursion records one reading of an open position's result.
func (s *Service) noteExcursion(symbol string, unrealized fixed.D) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.runs == nil {
		s.runs = map[string]*excursion{}
	}
	e := s.runs[symbol]
	if e == nil {
		e = &excursion{worst: unrealized, best: unrealized}
		s.runs[symbol] = e
	}
	if unrealized.Cmp(e.worst) < 0 {
		e.worst = unrealized
	}
	if unrealized.Cmp(e.best) > 0 {
		e.best = unrealized
	}
}

// takeExcursion reads and forgets what a symbol's position ran to.
func (s *Service) takeExcursion(symbol string) store.Excursion {
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.runs[symbol]
	if e == nil {
		return store.Excursion{}
	}
	delete(s.runs, symbol)
	worst, best := e.worst, e.best
	return store.Excursion{Worst: &worst, Best: &best}
}
