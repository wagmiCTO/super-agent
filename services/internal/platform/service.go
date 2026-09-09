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
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/policy"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
)

// Errors the service returns for conditions the API maps to distinct statuses.
var (
	ErrInvalid    = errors.New("platform: invalid request")
	ErrNoPosition = errors.New("platform: no open position")
)

// OpenRequest is what the app sends to take a position.
type OpenRequest struct {
	Symbol   string
	Side     venue.Side
	Notional fixed.D
	Leverage fixed.D
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
	s := &Service{venue: v, policy: p, account: accountKey, log: log}
	if err := s.reconcile(ctx); err != nil {
		return nil, err
	}
	return s, nil
}

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

// State is everything the app needs to render the account.
type State struct {
	Venue     string
	Account   venue.Account
	Positions []venue.Position
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
	return State{
		Venue:     s.venue.Name(),
		Account:   acct,
		Positions: positions,
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
	s.log.Info("opened", "symbol", req.Symbol, "side", req.Side, "notional", req.Notional,
		"leverage", req.Leverage, "order", placed.VenueID, "status", placed.Status, "fee", placed.Fee)
	return placed, nil
}

// Close flattens the open position in a market. It sizes the order from the
// venue's position, not from anything the caller sends: a close that could be
// partial or oversized is a way to end up with the opposite exposure.
func (s *Service) Close(ctx context.Context, req CloseRequest) (venue.Order, error) {
	symbol := strings.ToUpper(strings.TrimSpace(req.Symbol))
	if symbol == "" {
		return venue.Order{}, fmt.Errorf("%w: symbol is required", ErrInvalid)
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
	s.log.Info("closed", "symbol", symbol, "side", pos.Side, "size", pos.Size,
		"entry", pos.EntryPrice, "exit", placed.AvgPrice, "pnl", pnl, "fee", placed.Fee)
	return placed, nil
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
