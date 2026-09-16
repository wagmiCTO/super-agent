package platform

import (
	"context"
	"log/slog"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/venue"
)

// MarketSync keeps the markets the platform trades in step with the venue's
// own list. With no list configured every market the venue publishes is
// allowed; with one, only those of it the venue actually lists. A market
// that appears gets its signals started and becomes tradable on the next
// limits refresh; one that disappears is closed to new positions and its
// signals stopped. Positions already open on it are left to their exits.
type MarketSync struct {
	venue    venue.Adapter
	registry *Registry
	signals  *Signals
	// wanted narrows the venue's list; empty means all of it.
	wanted []string
	log    *slog.Logger
	every  time.Duration

	mu      sync.Mutex
	allowed []string
}

// NewMarketSync builds the watcher; registry and signals may be nil where a
// build has none. `wanted` empty means every market the venue lists.
func NewMarketSync(v venue.Adapter, registry *Registry, signals *Signals, wanted []string, log *slog.Logger) *MarketSync {
	if log == nil {
		log = slog.Default()
	}
	up := make([]string, 0, len(wanted))
	for _, w := range wanted {
		if w = strings.ToUpper(strings.TrimSpace(w)); w != "" && w != "*" {
			up = append(up, w)
		}
	}
	return &MarketSync{venue: v, registry: registry, signals: signals, wanted: up, log: log, every: 5 * time.Minute}
}

// Attach names who is told about a change; either may be nil.
func (m *MarketSync) Attach(registry *Registry, signals *Signals) {
	m.mu.Lock()
	m.registry, m.signals = registry, signals
	m.mu.Unlock()
}

// Allowed is the current list, sorted.
func (m *MarketSync) Allowed() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]string(nil), m.allowed...)
}

// Run syncs once now and then every few minutes until ctx ends. It blocks.
func (m *MarketSync) Run(ctx context.Context) {
	m.Sync(ctx)
	t := time.NewTicker(m.every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			m.Sync(ctx)
		}
	}
}

// Sync reads the venue's markets and applies any change.
func (m *MarketSync) Sync(ctx context.Context) {
	ms, err := m.venue.Markets(ctx)
	if err != nil {
		m.log.Warn("markets not read; the allowed list stays as it was", "err", err)
		return
	}
	listed := make([]string, 0, len(ms))
	for _, mk := range ms {
		sym := strings.ToUpper(mk.Symbol)
		if len(m.wanted) > 0 && !slices.Contains(m.wanted, sym) {
			continue
		}
		listed = append(listed, sym)
	}
	sort.Strings(listed)
	m.mu.Lock()
	changed := !slices.Equal(listed, m.allowed)
	m.allowed = listed
	registry, signals := m.registry, m.signals
	m.mu.Unlock()
	if !changed {
		return
	}
	if registry != nil {
		registry.SetAllowedSymbols(listed)
	}
	if signals != nil {
		signals.Ensure(ctx, listed)
	}
	m.log.Info("markets synced with the venue", "allowed", listed)
}
