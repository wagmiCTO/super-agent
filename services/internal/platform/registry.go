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

// Registry holds one Service per enrolled key, built lazily.
//
// A key is a wallet and a strategy (ADR 0005): each gets its own venue
// connection, authenticated with its own API key, and its own policy limits
// under the account "<wallet>/<strategy>". A wallet-wide key from before
// per-strategy keys serves every strategy through one shared service under
// the wallet's address. Nothing is shared between wallets except the process.
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
	mu        sync.Mutex
	byKey     map[string]*Service // by keys.Key.ID()
	pending   map[string]chan struct{}
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

// Get returns the service that trades strategyID for a wallet, connecting
// to the venue on first use. Concurrent first calls for the same key wait
// for one connection rather than opening several: the venue allows one
// session per key.
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

// PolicyAccount names the policy engine's account for a key: the wallet
// for a wallet-wide key, "<wallet>/<strategy>" for a strategy's own key.
func PolicyAccount(k keys.Key) string {
	if k.Strategy == "" {
		return k.Address
	}
	return k.Address + "/" + k.Strategy
}

// LimitsFor narrows the platform limits to a strategy's own cap from the
// catalog. A wallet-wide key trades under the platform limits as they are.
func LimitsFor(base policy.Limits, strategyID string) policy.Limits {
	info, ok := strategy.Lookup(strategyID)
	if !ok || info.NotionalCap == "" {
		return base
	}
	cap, err := fixed.Parse(info.NotionalCap)
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

// connect builds the venue connection and service for one key. It runs on
// the registry's own context: the request that triggered it only waits.
func (r *Registry) connect(k keys.Key) (*Service, error) {
	addr := k.Address
	v, err := r.build(r.ctx, k)
	if err != nil {
		return nil, fmt.Errorf("platform: connect venue for %s: %w", addr, err)
	}
	limits := r.limits
	if k.Strategy != "" {
		limits = LimitsFor(r.limits, k.Strategy)
	}
	svc, err := New(r.ctx, v, r.policy, PolicyAccount(k), limits, r.log.With("wallet", addr, "strategy", k.Strategy))
	if err != nil {
		_ = v.Close()
		return nil, err
	}
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
	r.log.Info("wallet connected to venue", "wallet", addr, "strategy", k.Strategy, "derived", k.Derived, "builder", k.BuilderID, "fee_per_100k", k.MaxBuilderFeePer100K)
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
