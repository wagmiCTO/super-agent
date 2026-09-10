package platform

import (
	"context"
	"encoding/hex"
	"log/slog"
	"sync"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/envio"
	"github.com/wagmiCTO/super-agent/services/internal/strategy"
)

// PrizeHistory is the chain's record of the weekly prizes, read from the
// Envio indexer and cached briefly. The lobby shows it as the weeks gone
// by: what each pool held, who won, who has collected.
type PrizeHistory struct {
	envio *envio.Client
	ttl   time.Duration
	log   *slog.Logger
	now   func() time.Time

	mu      sync.Mutex
	cached  History
	fetched time.Time
	err     error
}

// History is what the lobby reads.
type History struct {
	Pools  []HistoryPool
	Totals envio.Totals
	// Stale is true when the indexer could not be read and this is the
	// last good answer.
	Stale     bool
	UpdatedAt time.Time
}

// HistoryPool is one pool with the strategy id resolved from its key.
type HistoryPool struct {
	envio.Pool
	StrategyID string
	WeekStart  time.Time
}

const historyTTL = time.Minute

func NewPrizeHistory(c *envio.Client, log *slog.Logger) *PrizeHistory {
	if log == nil {
		log = slog.Default()
	}
	return &PrizeHistory{envio: c, ttl: historyTTL, log: log, now: time.Now}
}

// strategyByKey maps the indexer's bytes32 strategy keys back to ids.
var strategyByKey = func() map[string]string {
	out := make(map[string]string, len(strategy.Catalog))
	for _, s := range strategy.Catalog {
		k := StrategyKey(s.ID)
		out["0x"+hex.EncodeToString(k[:])] = s.ID
	}
	return out
}()

// Read returns the last weeks, refreshing from the indexer when the cache
// is older than a minute; on failure it serves the last good answer.
func (p *PrizeHistory) Read(ctx context.Context, limit int) (History, error) {
	p.mu.Lock()
	if !p.fetched.IsZero() && p.now().Sub(p.fetched) < p.ttl {
		h := p.cached
		p.mu.Unlock()
		return h, nil
	}
	p.mu.Unlock()

	pools, totals, err := p.envio.Pools(ctx, limit)
	p.mu.Lock()
	defer p.mu.Unlock()
	p.fetched = p.now()
	if err != nil {
		p.err = err
		p.log.Warn("prize history unavailable", "err", err)
		if p.cached.UpdatedAt.IsZero() {
			return History{}, err
		}
		p.cached.Stale = true
		return p.cached, nil
	}
	h := History{Totals: totals, UpdatedAt: p.now()}
	for _, pool := range pools {
		hp := HistoryPool{Pool: pool, StrategyID: strategyByKey[pool.Strategy]}
		var week uint64
		for _, ch := range pool.Week {
			if ch >= '0' && ch <= '9' {
				week = week*10 + uint64(ch-'0')
			}
		}
		hp.WeekStart = WeekStart(week)
		h.Pools = append(h.Pools, hp)
	}
	p.cached, p.err = h, nil
	return h, nil
}
