package platform

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/policy"
	"github.com/wagmiCTO/super-agent/services/internal/strategy"
)

// A wallet's limits come in two tiers. The safe tier is what everyone trades
// under until they say otherwise; the ceiling is as far as anyone may go.
// Between the two is the danger zone: the wallet's own choice, made on the
// risk screen with a second tap, stored, and applied to every strategy it
// trades. The platform's own limits from the environment stay underneath as
// hard caps on notional and exposure — they are deployment facts, not
// choices.
//
// Position size and leverage are deliberately not here. A position may use
// the whole balance as collateral, and leverage is whatever the venue allows
// on the market: the stop and the daily budget are the guards, not the size.

// LimitTier is one set of choices.
type LimitTier struct {
	// DailyLossPct is the day's loss budget as a share of the balance at the
	// start of the day.
	DailyLossPct float64 `json:"daily_loss_pct"`
	// MaxOpenPositions is how many positions may be open at once, across
	// every strategy.
	MaxOpenPositions int `json:"max_open_positions"`
	// CooldownSeconds is the pause between two taps.
	CooldownSeconds float64 `json:"cooldown_seconds"`
}

// SafeTier is what a wallet trades under until it chooses otherwise.
var SafeTier = LimitTier{DailyLossPct: 20, MaxOpenPositions: 2, CooldownSeconds: 10}

// CeilingTier is as far as the danger zone goes. The cooldown is a floor:
// it may be shortened to nothing, never lengthened past the safe tier's
// value by the ceiling — a longer pause is not a danger.
var CeilingTier = LimitTier{DailyLossPct: 75, MaxOpenPositions: 5, CooldownSeconds: 0}

// Validate reports whether a choice sits between the safe tier and the
// ceiling, in the direction that matters for each number.
func (t LimitTier) Validate() error {
	if t.DailyLossPct < 1 || t.DailyLossPct > CeilingTier.DailyLossPct {
		return fmt.Errorf("%w: daily_loss_pct must be between 1 and %v", ErrInvalid, CeilingTier.DailyLossPct)
	}
	if t.MaxOpenPositions < 1 || t.MaxOpenPositions > CeilingTier.MaxOpenPositions {
		return fmt.Errorf("%w: max_open_positions must be between 1 and %d", ErrInvalid, CeilingTier.MaxOpenPositions)
	}
	if t.CooldownSeconds < CeilingTier.CooldownSeconds || t.CooldownSeconds > 60 {
		return fmt.Errorf("%w: cooldown_seconds must be between %v and 60", ErrInvalid, CeilingTier.CooldownSeconds)
	}
	return nil
}

// WalletLimits is a wallet's stored choice.
type WalletLimits struct {
	Address string
	LimitTier
}

// LimitsStore keeps each wallet's choice.
type LimitsStore interface {
	WalletLimits(ctx context.Context, address string) (WalletLimits, bool, error)
	SaveWalletLimits(ctx context.Context, w WalletLimits) error
}

// MemLimits is a LimitsStore in memory, for tests and for a platform run
// without a database.
type MemLimits struct {
	mu sync.Mutex
	m  map[string]WalletLimits
}

func NewMemLimits() *MemLimits { return &MemLimits{m: map[string]WalletLimits{}} }

func (m *MemLimits) WalletLimits(_ context.Context, address string) (WalletLimits, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	w, ok := m.m[strings.ToLower(address)]
	return w, ok, nil
}

func (m *MemLimits) SaveWalletLimits(_ context.Context, w WalletLimits) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.m[strings.ToLower(w.Address)] = w
	return nil
}

// tierFor is what a wallet trades under: its choice, or the safe tier. A
// store error is logged by the caller's absence of choice, not surfaced: the
// safe tier is always a correct answer.
func tierFor(ctx context.Context, store LimitsStore, address string) LimitTier {
	if store == nil {
		return SafeTier
	}
	w, ok, err := store.WalletLimits(ctx, address)
	if err != nil || !ok {
		return SafeTier
	}
	return w.LimitTier
}

// ComputeLimits turns a tier into the absolute limits the engine judges.
//
// The loss budget is a share of the balance at the start of the day, which is
// the balance now plus what the day has lost so far. It is recomputed on
// every read, so a deposit raises it and a withdrawal lowers it; a losing
// day does not shrink its own budget as it goes. A budget that comes out at
// nothing — an empty account — falls back to the platform's own number, so
// the limits stay coherent and the refusal stays loud.
//
// Leverage is the venue's own maximum when it is known; the platform's
// number is only the fallback before the markets have been read.
func ComputeLimits(base policy.Limits, tier LimitTier, balance, lossToday, venueMaxLeverage fixed.D) policy.Limits {
	out := base
	pct, err := fixed.Parse(strconv.FormatFloat(tier.DailyLossPct, 'f', 2, 64))
	if err == nil && pct.IsPos() {
		start := balance.Add(lossToday)
		if budget := start.Mul(pct).Div(fixed.FromInt(100)); budget.IsPos() {
			out.DailyLoss = budget
		}
	}
	out.MaxOpenPositions = tier.MaxOpenPositions
	out.Cooldown = time.Duration(tier.CooldownSeconds * float64(time.Second))
	if venueMaxLeverage.IsPos() {
		out.MaxLeverage = venueMaxLeverage
	}
	return out
}

// --- the API ---

// limitsBlockDTO is the risk screen's view of the tiers: what the wallet
// chose, what it could choose, and what that means in money right now.
type limitsBlockDTO struct {
	Chosen  LimitTier `json:"chosen"`
	Safe    LimitTier `json:"safe"`
	Ceiling LimitTier `json:"ceiling"`
	// Active is the absolute limits in force for the wallet right now; absent
	// for a wallet with no strategy key yet.
	Active *limitsDTO `json:"active,omitempty"`
	// Balance is what the budget is a share of.
	Balance string `json:"balance,omitempty"`
	// DayResetsAt is when the loss budget starts over: the next midnight UTC.
	DayResetsAt string `json:"day_resets_at"`
}

// limitsBlockFrom assembles the block from states already read. Every
// service of a wallet shares one group, so any one state says what is in
// force; the first is as good as another.
func limitsBlockFrom(chosen LimitTier, states map[*Service]State, now time.Time) limitsBlockDTO {
	out := limitsBlockDTO{Chosen: chosen, Safe: SafeTier, Ceiling: CeilingTier, DayResetsAt: timeOrEmpty(StartOfDay(now.UTC()).Add(24 * time.Hour))}
	for _, st := range states {
		lim := toStateDTO(st).Limits
		out.Active = &lim
		out.Balance = st.Account.Balance.String()
		break
	}
	return out
}

func (h *handler) limitsBlock(ctx context.Context, wallet string, services map[string]*Service) limitsBlockDTO {
	states := map[*Service]State{}
	for _, s := range strategy.Catalog {
		svc := services[s.ID]
		if svc == nil {
			continue
		}
		st, err := svc.State(ctx)
		if err != nil {
			continue
		}
		states[svc] = st
		break
	}
	return limitsBlockFrom(tierFor(ctx, h.limits, wallet), states, time.Now())
}

// getLimits answers what the wallet trades under.
func (h *handler) getLimits(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	services, wallet, ok := h.riskServices(ctx, w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, h.limitsBlock(ctx, wallet, services))
}

// putLimits records the wallet's choice. Every number is checked against the
// tiers; the engine sees the change on the wallet's next read or tap.
func (h *handler) putLimits(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var tier LimitTier
	if err := decode(r, &tier); err != nil {
		h.fail(w, err)
		return
	}
	if err := tier.Validate(); err != nil {
		h.fail(w, err)
		return
	}
	services, wallet, ok := h.riskServices(ctx, w, r)
	if !ok {
		return
	}
	if h.limits == nil {
		h.fail(w, errors.New("limits store is not configured"))
		return
	}
	if err := h.limits.SaveWalletLimits(ctx, WalletLimits{Address: wallet, LimitTier: tier}); err != nil {
		h.fail(w, err)
		return
	}
	danger := tier.DailyLossPct > SafeTier.DailyLossPct || tier.MaxOpenPositions > SafeTier.MaxOpenPositions || tier.CooldownSeconds < SafeTier.CooldownSeconds
	h.log.Warn("limits chosen", "wallet", wallet, "daily_loss_pct", tier.DailyLossPct, "max_open_positions", tier.MaxOpenPositions, "cooldown_seconds", tier.CooldownSeconds, "danger", danger)
	writeJSON(w, http.StatusOK, h.limitsBlock(ctx, wallet, services))
}
