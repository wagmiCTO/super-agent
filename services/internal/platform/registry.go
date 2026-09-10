package platform

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"

	"github.com/wagmiCTO/super-agent/services/internal/keys"
	"github.com/wagmiCTO/super-agent/services/internal/policy"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
	"github.com/wagmiCTO/super-agent/services/internal/venue/perpl"
)

// ErrNoKey is returned for a wallet that has not enrolled an exchange key.
var ErrNoKey = errors.New("platform: no exchange key enrolled for this wallet")

// VenueFactory builds a venue adapter for one enrolled key. It is a function
// so the registry can be tested without a network.
type VenueFactory func(ctx context.Context, k keys.Key) (venue.Adapter, error)

// Registry holds one Service per enrolled wallet, built lazily from its key.
//
// Each wallet gets its own venue connection, authenticated with its own
// API key, and its own policy limits under its own address. Nothing is
// shared between wallets except the process.
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
	byAddr    map[string]*Service
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
		byAddr:  make(map[string]*Service),
		pending: make(map[string]chan struct{}),
	}
}

// Get returns the service for a wallet, connecting to the venue on first use.
// Concurrent first calls for the same wallet wait for one connection rather
// than opening several: the venue caps sockets per wallet.
func (r *Registry) Get(ctx context.Context, address string) (*Service, error) {
	addr := strings.ToLower(strings.TrimSpace(address))
	if addr == "" {
		return nil, fmt.Errorf("%w: address is required", ErrInvalid)
	}
	for {
		r.mu.Lock()
		if svc, ok := r.byAddr[addr]; ok {
			r.mu.Unlock()
			return svc, nil
		}
		if wait, ok := r.pending[addr]; ok {
			r.mu.Unlock()
			select {
			case <-wait:
				continue
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		done := make(chan struct{})
		r.pending[addr] = done
		r.mu.Unlock()

		svc, err := r.connect(ctx, addr)

		r.mu.Lock()
		delete(r.pending, addr)
		if err == nil {
			r.byAddr[addr] = svc
		}
		r.mu.Unlock()
		close(done)
		return svc, err
	}
}

func (r *Registry) connect(ctx context.Context, addr string) (*Service, error) {
	k, err := r.store.Get(addr)
	if err != nil {
		return nil, ErrNoKey
	}
	// The request context only bounds this call; the connection lives on.
	_ = ctx
	v, err := r.build(r.ctx, k)
	if err != nil {
		return nil, fmt.Errorf("platform: connect venue for %s: %w", addr, err)
	}
	svc, err := New(r.ctx, v, r.policy, addr, r.limits, r.log.With("wallet", addr))
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
	r.log.Info("wallet connected to venue", "wallet", addr, "builder", k.BuilderID, "fee_per_100k", k.MaxBuilderFeePer100K)
	return svc, nil
}

// Close disconnects every wallet.
func (r *Registry) Close() {
	r.cancel()
	r.mu.Lock()
	defer r.mu.Unlock()
	for addr, svc := range r.byAddr {
		svc.Shutdown()
		_ = svc.venue.Close()
		delete(r.byAddr, addr)
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
