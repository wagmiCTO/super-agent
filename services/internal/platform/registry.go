package platform

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/keys"
	"github.com/wagmiCTO/super-agent/services/internal/policy"
	"github.com/wagmiCTO/super-agent/services/internal/strategy"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
	"github.com/wagmiCTO/super-agent/services/internal/venue/perpl"
)

// ErrNoKey is returned for a wallet that has not enrolled an exchange key.
var ErrNoKey = errors.New("platform: no exchange key enrolled for this wallet")

// VenueFactory builds a venue adapter for one enrolled key. It is a function
// so the registry can be tested without a network.
type VenueFactory func(ctx context.Context, k keys.Key) (venue.Adapter, error)

// Registry holds one Service per wallet, built lazily.
//
// A wallet has one exchange key and every strategy trades through it (ADR
// 0007): one venue connection, one service, one policy account under the
// wallet's address. A key enrolled for a strategy under ADR 0005 is that
// wallet's key. Nothing is shared between wallets except the process.
type Registry struct {
	// ctx outlives any request: a wallet's venue connection is built on it,
	// not on the request that happened to be first. Close cancels it.
	ctx    context.Context
	cancel context.CancelFunc
	store  *keys.Store
	build  VenueFactory
	limits policy.Limits
	policy *policy.Engine
	log    *slog.Logger
	ledger *Ledger
	// OnConnect runs for every newly built service (restoring its state).
	OnConnect func(*Service) error
	// prefs keeps each wallet's chosen limits; nil means the safe tier.
	prefs LimitsStore
	// maxLeverage is the venue's own ceiling, read once from the markets.
	maxLeverage     fixed.D
	maxLeverageOnce sync.Once
	mu              sync.Mutex
	byKey           map[string]*Service // by keys.Key.ID()
	pending         map[string]chan struct{}
}

// NewRegistry wires a registry. limits apply to every wallet until per-wallet
// limits exist; ledger, when given, records every wallet's round trips.
func NewRegistry(store *keys.Store, build VenueFactory, limits policy.Limits, ledger *Ledger, eng *policy.Engine, log *slog.Logger) *Registry {
	if log == nil {
		log = slog.Default()
	}
	if eng == nil {
		eng = policy.New()
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &Registry{
		ctx:     ctx,
		cancel:  cancel,
		store:   store,
		build:   build,
		limits:  limits,
		ledger:  ledger,
		policy:  eng,
		log:     log,
		byKey:   make(map[string]*Service),
		pending: make(map[string]chan struct{}),
	}
}

// Get returns the wallet's service, connecting to the venue on first use.
// strategyID is checked against the catalog and otherwise only names what
// the request is about; every strategy is the same service. Concurrent
// first calls for the same wallet wait for one connection rather than
// opening several: the venue allows one session per key.
func (r *Registry) Get(ctx context.Context, address, strategyID string) (*Service, error) {
	addr := strings.ToLower(strings.TrimSpace(address))
	if addr == "" {
		return nil, fmt.Errorf("%w: address is required", ErrInvalid)
	}
	strategyID = strings.TrimSpace(strategyID)
	if strategyID != "" && !strategy.Known(strategyID) {
		return nil, fmt.Errorf("%w: unknown strategy %q", ErrInvalid, strategyID)
	}
	k, err := r.store.Resolve(addr, strategyID)
	if err != nil {
		return nil, ErrNoKey
	}
	id := k.ID()
	for {
		r.mu.Lock()
		if svc, ok := r.byKey[id]; ok {
			r.mu.Unlock()
			return svc, nil
		}
		if wait, ok := r.pending[id]; ok {
			r.mu.Unlock()
			select {
			case <-wait:
				continue
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		done := make(chan struct{})
		r.pending[id] = done
		r.mu.Unlock()

		svc, err := r.connect(k)

		r.mu.Lock()
		delete(r.pending, id)
		if err == nil {
			r.byKey[id] = svc
		}
		r.mu.Unlock()
		close(done)
		return svc, err
	}
}

// baseLimits is the platform's limits as they stand now.
func (r *Registry) baseLimits() policy.Limits {
	r.mu.Lock()
	defer r.mu.Unlock()
	l := r.limits
	l.AllowedSymbols = append([]string(nil), r.limits.AllowedSymbols...)
	return l
}

// SetAllowedSymbols replaces the markets every key may trade. Keys already
// connected see it on their next limits refresh, which precedes every order.
func (r *Registry) SetAllowedSymbols(symbols []string) {
	r.mu.Lock()
	r.limits.AllowedSymbols = append([]string(nil), symbols...)
	r.mu.Unlock()
}

// PolicyAccount names the policy engine's account for a key: the wallet's
// address, whatever strategy the key was enrolled under (ADR 0007).
func PolicyAccount(k keys.Key) string {
	return strings.ToLower(k.Address)
}

// legacyPolicyAccount is the account a strategy's own key traded under
// before ADR 0007; what it journaled is restored under the wallet's.
func legacyPolicyAccount(wallet, strategyID string) string {
	return strings.ToLower(wallet) + "/" + strategyID
}

// LimitsFor narrows the platform limits to a strategy's own cap from the
// catalog, for the order that names it.
func LimitsFor(base policy.Limits, strategyID string) policy.Limits {
	info, ok := strategy.Lookup(strategyID)
	if !ok {
		return base
	}
	return limitsWithCap(base, info.NotionalCap)
}

// limitsWithCap applies one catalog cap. Anything that is not a positive
// number below the platform's own limit leaves the limits as they are.
func limitsWithCap(base policy.Limits, notionalCap string) policy.Limits {
	if notionalCap == "" {
		return base
	}
	cap, err := fixed.Parse(notionalCap)
	if err != nil || !cap.IsPos() || cap.Cmp(base.MaxNotional) >= 0 {
		return base
	}
	out := base
	out.MaxNotional = cap
	if out.MinNotional.Cmp(cap) > 0 {
		out.MinNotional = cap
	}
	return out
}

// UsePrefs makes wallets trade under the limits they chose.
func (r *Registry) UsePrefs(s LimitsStore) {
	r.mu.Lock()
	r.prefs = s
	r.mu.Unlock()
}

// venueMaxLeverage is the highest leverage the venue allows on any market the
// platform trades: leverage is the venue's call, not the platform's.
func (r *Registry) venueMaxLeverage(ctx context.Context, svc *Service) fixed.D {
	r.maxLeverageOnce.Do(func() {
		ms, err := svc.Markets(ctx)
		if err != nil {
			return
		}
		allowed := map[string]bool{}
		for _, sym := range r.limits.AllowedSymbols {
			allowed[strings.ToUpper(sym)] = true
		}
		for _, m := range ms {
			if len(allowed) > 0 && !allowed[strings.ToUpper(m.Symbol)] {
				continue
			}
			if m.MaxLeverage.Cmp(r.maxLeverage) > 0 {
				r.maxLeverage = m.MaxLeverage
			}
		}
	})
	return r.maxLeverage
}

// connect builds the venue connection and service for one key. It runs on
// the registry's own context: the request that triggered it only waits.
func (r *Registry) connect(k keys.Key) (*Service, error) {
	addr := k.Address
	v, err := r.build(r.ctx, k)
	if err != nil {
		return nil, fmt.Errorf("platform: connect venue for %s: %w", addr, err)
	}
	// The base limits are read again on every refresh, not captured once:
	// the markets the platform allows follow the venue's list (MarketSync),
	// and a key connected before a listing must see it too.
	forKey := func() policy.Limits {
		limits := r.baseLimits()
		// One person, one day: every strategy the wallet trades shares its
		// budget, its cooldown and its count of open positions.
		limits.Group = strings.ToLower(addr)
		return limits
	}
	svc, err := New(r.ctx, v, r.policy, PolicyAccount(k), forKey(), r.log.With("wallet", addr))
	if err != nil {
		_ = v.Close()
		return nil, err
	}
	r.mu.Lock()
	prefs := r.prefs
	r.mu.Unlock()
	svc.UseLimits(func(ctx context.Context, balance, lossToday fixed.D) policy.Limits {
		return ComputeLimits(forKey(), tierFor(ctx, prefs, addr), balance, lossToday, r.venueMaxLeverage(ctx, svc))
	})
	if r.ledger != nil {
		svc.UseLedger(r.ledger)
	}
	if r.OnConnect != nil {
		if err := r.OnConnect(svc); err != nil {
			svc.Shutdown()
			_ = v.Close()
			return nil, err
		}
	}
	r.log.Info("wallet connected to venue", "wallet", addr, "key_label", k.Label, "derived", k.Derived, "builder", k.BuilderID, "fee_per_100k", k.MaxBuilderFeePer100K)
	return svc, nil
}

// Close disconnects every key.
func (r *Registry) Close() {
	r.cancel()
	r.mu.Lock()
	defer r.mu.Unlock()
	for id, svc := range r.byKey {
		svc.Shutdown()
		_ = svc.venue.Close()
		delete(r.byKey, id)
	}
}

// PerplFactory builds a Perpl adapter for an enrolled key on the given network.
// The key's fee ceiling is charged on every order: it is what the wallet
// consented to, and it is the platform's revenue.
func PerplFactory(base perpl.Config, log *slog.Logger) VenueFactory {
	return func(ctx context.Context, k keys.Key) (venue.Adapter, error) {
		cfg := base
		cfg.APIKey = k.APIKey
		cfg.APIKeySecret = hex.EncodeToString(k.PrivateKey)
		cfg.AccountID = 0
		cfg.BuilderFeePer100K = k.MaxBuilderFeePer100K
		return perpl.New(ctx, cfg, log)
	}
}
