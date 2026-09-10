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
}

// CloseReason says who closed a position.
type CloseReason string

const (
	CloseManual  CloseReason = "manual"
	CloseHorizon CloseReason = "horizon"
)

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

// Service is the trading core. One instance serves one exchange account; the
// per-user layer arrives with the account layer and sits above this.
type Service struct {
	venue   venue.Adapter
	policy  *policy.Engine
	account string
	log     *slog.Logger
	timers  *strategy.Timers
	now     func() time.Time
	// ledger is shared across wallets; nil keeps no leaderboard.
	ledger *Ledger
	// store, when set, keeps pending horizons across restarts.
	store *store.Store

	mu        sync.Mutex
	lastClose *CloseEvent
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
	s := &Service{venue: v, policy: p, account: accountKey, log: log, timers: strategy.NewTimers(), now: time.Now}
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
	for _, h := range hs {
		symbol := h.Symbol
		s.timers.Schedule(symbol, h.ClosesAt, func() { s.closeOnHorizon(symbol) })
		s.log.Info("horizon restored", "symbol", symbol, "closes_at", h.ClosesAt)
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
	LastClose *CloseEvent
	Limits    policy.Limits
	Risk      policy.Snapshot
	Killed    bool
	KillNote  string
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
	limits, _ := s.policy.Limits(s.account)
	killed, note := s.policy.Killed()
	deadlines := make(map[string]time.Time, len(positions))
	for _, p := range positions {
		if at, ok := s.timers.Deadline(p.Symbol); ok {
			deadlines[p.Symbol] = at
		}
	}
	s.mu.Lock()
	last := s.lastClose
	s.mu.Unlock()
	return State{
		Venue:     s.venue.Name(),
		Account:   acct,
		Positions: positions,
		Deadlines: deadlines,
		LastClose: last,
		Limits:    limits,
		Risk:      s.policy.Snapshot(s.account),
		Killed:    killed,
		KillNote:  note,
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

	order := venue.OrderRequest{
		ClientID: newClientID("open"),
		Symbol:   req.Symbol,
		Side:     req.Side,
		Notional: req.Notional,
		Leverage: req.Leverage,
	}
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
		s.ledger.Opened(s.account, req.Strategy, req.Symbol, placed.VenueID, store.Fill{Side: req.Side.String(), Size: placed.FilledSize, Price: placed.AvgPrice, Fee: placed.Fee})
	}
	if req.Rules.Horizon > 0 {
		// The exit is armed the moment the entry is confirmed. It fires on
		// its own goroutine and goes through the same Close as a tap would.
		symbol := req.Symbol
		closesAt := s.now().Add(req.Rules.Horizon)
		s.timers.Schedule(symbol, closesAt, func() { s.closeOnHorizon(symbol) })
		if s.store != nil {
			if err := s.store.SaveHorizon(ctx, store.Horizon{Account: s.account, Symbol: symbol, ClosesAt: closesAt}); err != nil {
				s.log.Warn("horizon not persisted", "symbol", symbol, "err", err)
			}
		}
	}
	s.log.Info("opened", "symbol", req.Symbol, "side", req.Side, "notional", req.Notional,
		"leverage", req.Leverage, "horizon", req.Rules.Horizon, "strategy", req.Strategy, "order", placed.VenueID, "status", placed.Status, "fee", placed.Fee)
	return placed, nil
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
		s.ledger.Closed(s.account, symbol, pnl, placed.VenueID, store.Fill{Side: pos.Side.String(), Size: placed.FilledSize, Price: placed.AvgPrice, Fee: placed.Fee}, string(reason))
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
	return s.ledger.Trades(ctx, s.account, strings.ToUpper(strings.TrimSpace(symbol)), strings.TrimSpace(strategyID), limit)
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
