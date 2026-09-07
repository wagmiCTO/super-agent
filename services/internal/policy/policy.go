// Package policy decides whether a trading action is allowed.
//
// Every order the platform places passes through here first. There is no bypass
// path, not even for tests — a test that needs a permissive engine builds one
// with permissive limits, it does not skip the check. That rule exists because
// this system moves real money on behalf of people who are not watching it.
//
// The engine is deliberately boring: it holds limits, it holds the little state
// those limits need, and it answers yes or no with a reason. It does not place
// orders, talk to a venue, or know what a strategy is.
package policy

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
)

// Reason identifies why an action was refused. The API maps these onto messages
// a person can act on, so they are part of the contract, not just logging.
type Reason string

const (
	ReasonKillSwitch       Reason = "kill_switch"
	ReasonSymbolNotAllowed Reason = "symbol_not_allowed"
	ReasonNotionalTooLarge Reason = "notional_too_large"
	ReasonNotionalTooSmall Reason = "notional_too_small"
	ReasonLeverageTooHigh  Reason = "leverage_too_high"
	ReasonDailyLossReached Reason = "daily_loss_limit_reached"
	ReasonCooldown         Reason = "cooldown"
	ReasonTooManyPositions Reason = "too_many_open_positions"
	ReasonExposureTooLarge Reason = "total_exposure_too_large"
	ReasonMalformed        Reason = "malformed_request"
)

// ErrDenied is returned by Authorize for every refusal; the specific Reason is
// carried by a *Denial in the error chain.
var ErrDenied = errors.New("policy: denied")

// Denial is the refusal itself: what was refused, why, and the numbers behind
// it so the caller can tell the user "you asked for X, the limit is Y".
type Denial struct {
	Reason  Reason
	Message string
	// Limit and Actual are set when the reason is a numeric limit.
	Limit  fixed.D
	Actual fixed.D
	// RetryAfter is set when the refusal is temporary, as for a cooldown.
	RetryAfter time.Duration
}

func (d *Denial) Error() string { return fmt.Sprintf("policy: %s: %s", d.Reason, d.Message) }

// Is lets errors.Is(err, ErrDenied) match any denial.
func (d *Denial) Is(target error) bool { return target == ErrDenied }

// Limits are the rules for one account. A zero value denies everything, which
// is the safe default: limits must be set deliberately.
type Limits struct {
	// AllowedSymbols is the whitelist. Empty denies every symbol.
	AllowedSymbols []string
	// MaxNotional caps one position's value in collateral units.
	MaxNotional fixed.D
	// MinNotional rejects dust, which costs fees and cannot profit.
	MinNotional fixed.D
	// MaxLeverage caps leverage regardless of what the venue allows.
	MaxLeverage fixed.D
	// MaxTotalExposure caps the sum of open position notionals.
	MaxTotalExposure fixed.D
	// MaxOpenPositions caps how many positions may be open at once.
	MaxOpenPositions int
	// DailyLoss is how much may be lost in a rolling calendar day before
	// opening is refused. Closing is always allowed.
	DailyLoss fixed.D
	// Cooldown is the minimum gap between two opening orders.
	Cooldown time.Duration
}

// Validate reports whether the limits are internally coherent. It is called
// when limits are set rather than on every order.
func (l Limits) Validate() error {
	if len(l.AllowedSymbols) == 0 {
		return errors.New("policy: limits allow no symbols")
	}
	if !l.MaxNotional.IsPos() {
		return errors.New("policy: MaxNotional must be positive")
	}
	if l.MinNotional.IsNeg() {
		return errors.New("policy: MinNotional must not be negative")
	}
	if l.MinNotional.Cmp(l.MaxNotional) > 0 {
		return fmt.Errorf("policy: MinNotional %s exceeds MaxNotional %s", l.MinNotional, l.MaxNotional)
	}
	if !l.MaxLeverage.IsPos() {
		return errors.New("policy: MaxLeverage must be positive")
	}
	if l.MaxOpenPositions <= 0 {
		return errors.New("policy: MaxOpenPositions must be positive")
	}
	if !l.DailyLoss.IsPos() {
		return errors.New("policy: DailyLoss must be positive")
	}
	if l.Cooldown < 0 {
		return errors.New("policy: Cooldown must not be negative")
	}
	return nil
}

// Request is one action to authorize. It mirrors venue.OrderRequest but carries
// only what a policy decision needs, so the engine cannot accidentally depend on
// venue-specific fields.
type Request struct {
	Account string
	Symbol  string
	// Reduce marks an order that only closes exposure. Closing is never
	// refused on risk grounds — refusing to let someone out is the one way a
	// risk limit can make things worse.
	Reduce bool
	// Notional is the position value in collateral units.
	Notional fixed.D
	Leverage fixed.D
}

// FromOrder builds a Request from a venue order, so callers cannot forget a
// field when the two structs drift.
func FromOrder(account string, o venue.OrderRequest) Request {
	return Request{
		Account:  account,
		Symbol:   o.Symbol,
		Reduce:   o.Reduce,
		Notional: o.Notional,
		Leverage: o.Leverage,
	}
}

// accountState is the little history the limits need. It is rebuilt from the
// venue on startup rather than trusted from disk.
type accountState struct {
	lastOpen      time.Time
	dayStart      time.Time
	realizedLoss  fixed.D
	openPositions int
	exposure      fixed.D
}

// Engine authorizes actions against per-account limits.
type Engine struct {
	now func() time.Time

	mu         sync.Mutex
	killSwitch bool
	killReason string
	limits     map[string]Limits
	state      map[string]*accountState
}

// New builds an engine with no accounts configured. An account with no limits
// is denied, so adding one is always an explicit act.
func New() *Engine {
	return &Engine{
		now:    time.Now,
		limits: make(map[string]Limits),
		state:  make(map[string]*accountState),
	}
}

// SetLimits installs limits for an account, rejecting incoherent ones.
func (e *Engine) SetLimits(account string, l Limits) error {
	if account == "" {
		return errors.New("policy: account is required")
	}
	if err := l.Validate(); err != nil {
		return err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	e.limits[account] = l
	return nil
}

// Limits returns the limits in force for an account.
func (e *Engine) Limits(account string) (Limits, bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	l, ok := e.limits[account]
	return l, ok
}

// Kill stops all opening across every account. Closing stays allowed: a kill
// switch that traps people in positions is worse than no kill switch.
func (e *Engine) Kill(reason string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.killSwitch, e.killReason = true, reason
}

// Revive clears the kill switch.
func (e *Engine) Revive() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.killSwitch, e.killReason = false, ""
}

// Killed reports whether the kill switch is engaged, and why.
func (e *Engine) Killed() (bool, string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.killSwitch, e.killReason
}

// Authorize decides whether the request may proceed. A nil error means yes.
func (e *Engine) Authorize(req Request) error {
	if req.Account == "" || req.Symbol == "" {
		return &Denial{Reason: ReasonMalformed, Message: "account and symbol are required"}
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	// Closing is always permitted. Every check below is about taking on
	// risk, and none of them should ever stop someone reducing it.
	if req.Reduce {
		return nil
	}

	if e.killSwitch {
		return &Denial{Reason: ReasonKillSwitch, Message: e.killReasonLocked()}
	}

	limits, ok := e.limits[req.Account]
	if !ok {
		return &Denial{
			Reason:  ReasonMalformed,
			Message: fmt.Sprintf("no limits configured for account %s", req.Account),
		}
	}

	if !symbolAllowed(limits.AllowedSymbols, req.Symbol) {
		return &Denial{
			Reason:  ReasonSymbolNotAllowed,
			Message: fmt.Sprintf("%s is not in the allowed markets", req.Symbol),
		}
	}
	if !req.Notional.IsPos() {
		return &Denial{Reason: ReasonMalformed, Message: "notional must be positive"}
	}
	if req.Notional.Cmp(limits.MinNotional) < 0 {
		return &Denial{
			Reason:  ReasonNotionalTooSmall,
			Message: fmt.Sprintf("minimum position is %s", limits.MinNotional),
			Limit:   limits.MinNotional, Actual: req.Notional,
		}
	}
	if req.Notional.Cmp(limits.MaxNotional) > 0 {
		return &Denial{
			Reason:  ReasonNotionalTooLarge,
			Message: fmt.Sprintf("maximum position is %s", limits.MaxNotional),
			Limit:   limits.MaxNotional, Actual: req.Notional,
		}
	}
	if req.Leverage.Cmp(limits.MaxLeverage) > 0 {
		return &Denial{
			Reason:  ReasonLeverageTooHigh,
			Message: fmt.Sprintf("maximum leverage is %s", limits.MaxLeverage),
			Limit:   limits.MaxLeverage, Actual: req.Leverage,
		}
	}

	st := e.stateLocked(req.Account)
	e.rollDayLocked(st)

	if st.realizedLoss.Cmp(limits.DailyLoss) >= 0 {
		return &Denial{
			Reason:  ReasonDailyLossReached,
			Message: fmt.Sprintf("daily loss limit of %s reached; opening resumes tomorrow", limits.DailyLoss),
			Limit:   limits.DailyLoss, Actual: st.realizedLoss,
			RetryAfter: e.untilTomorrowLocked(st),
		}
	}
	if st.openPositions >= limits.MaxOpenPositions {
		return &Denial{
			Reason:  ReasonTooManyPositions,
			Message: fmt.Sprintf("at most %d positions may be open at once", limits.MaxOpenPositions),
			Limit:   fixed.FromInt(int64(limits.MaxOpenPositions)),
			Actual:  fixed.FromInt(int64(st.openPositions)),
		}
	}
	if limits.MaxTotalExposure.IsPos() {
		if total := st.exposure.Add(req.Notional); total.Cmp(limits.MaxTotalExposure) > 0 {
			return &Denial{
				Reason:  ReasonExposureTooLarge,
				Message: fmt.Sprintf("total exposure would be %s, limit is %s", total, limits.MaxTotalExposure),
				Limit:   limits.MaxTotalExposure, Actual: total,
			}
		}
	}
	if limits.Cooldown > 0 && !st.lastOpen.IsZero() {
		if elapsed := e.now().Sub(st.lastOpen); elapsed < limits.Cooldown {
			return &Denial{
				Reason:     ReasonCooldown,
				Message:    fmt.Sprintf("wait %s before opening again", (limits.Cooldown - elapsed).Round(time.Second)),
				RetryAfter: limits.Cooldown - elapsed,
			}
		}
	}
	return nil
}

// RecordOpen notes that an opening order was actually placed. It is called
// after the venue accepts the order, not before: a refused order must not start
// a cooldown or consume an exposure slot.
func (e *Engine) RecordOpen(account string, notional fixed.D) {
	e.mu.Lock()
	defer e.mu.Unlock()
	st := e.stateLocked(account)
	e.rollDayLocked(st)
	st.lastOpen = e.now()
	st.openPositions++
	st.exposure = st.exposure.Add(notional)
}

// RecordClose notes a position closing with its realized profit or loss.
// A loss is a negative pnl.
func (e *Engine) RecordClose(account string, notional, pnl fixed.D) {
	e.mu.Lock()
	defer e.mu.Unlock()
	st := e.stateLocked(account)
	e.rollDayLocked(st)
	if st.openPositions > 0 {
		st.openPositions--
	}
	st.exposure = st.exposure.Sub(notional)
	if st.exposure.IsNeg() {
		st.exposure = 0
	}
	if pnl.IsNeg() {
		st.realizedLoss = st.realizedLoss.Add(pnl.Abs())
	}
}

// Reconcile replaces the engine's view of open exposure with the venue's. It is
// how the platform recovers after a restart: positions are read from the
// exchange and the engine is told what is actually open, rather than trusting
// its own memory.
func (e *Engine) Reconcile(account string, positions []venue.Position) {
	e.mu.Lock()
	defer e.mu.Unlock()
	st := e.stateLocked(account)
	e.rollDayLocked(st)

	var exposure fixed.D
	for _, p := range positions {
		exposure = exposure.Add(p.EntryPrice.Mul(p.Size))
	}
	st.openPositions = len(positions)
	st.exposure = exposure
}

// Snapshot reports the state behind the limits, for the API and for operators.
type Snapshot struct {
	OpenPositions int
	Exposure      fixed.D
	DailyLoss     fixed.D
	LastOpen      time.Time
}

// Snapshot returns the current state for an account.
func (e *Engine) Snapshot(account string) Snapshot {
	e.mu.Lock()
	defer e.mu.Unlock()
	st := e.stateLocked(account)
	e.rollDayLocked(st)
	return Snapshot{
		OpenPositions: st.openPositions,
		Exposure:      st.exposure,
		DailyLoss:     st.realizedLoss,
		LastOpen:      st.lastOpen,
	}
}

func (e *Engine) stateLocked(account string) *accountState {
	st, ok := e.state[account]
	if !ok {
		st = &accountState{dayStart: startOfDay(e.now())}
		e.state[account] = st
	}
	return st
}

// rollDayLocked resets the daily loss when the calendar day turns over in UTC.
// UTC rather than local time so the reset is the same for every user and does
// not move twice a year.
func (e *Engine) rollDayLocked(st *accountState) {
	today := startOfDay(e.now())
	if st.dayStart.Before(today) {
		st.dayStart = today
		st.realizedLoss = 0
	}
}

func (e *Engine) untilTomorrowLocked(st *accountState) time.Duration {
	return st.dayStart.Add(24 * time.Hour).Sub(e.now())
}

func (e *Engine) killReasonLocked() string {
	if e.killReason == "" {
		return "trading is halted"
	}
	return e.killReason
}

func startOfDay(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

func symbolAllowed(allowed []string, symbol string) bool {
	return slices.ContainsFunc(allowed, func(s string) bool {
		return strings.EqualFold(s, symbol)
	})
}
