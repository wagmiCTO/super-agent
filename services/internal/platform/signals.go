package platform

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/strategy"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
)

// Signals keeps the strategies' signals alive on one market-data connection,
// shared by every wallet: a signal is about the market, not about a user.
// Each symbol's signal is seeded from candle history, then fed by the live
// candle stream, and re-seeded whenever the stream has to be reopened so a
// cross that happened during the gap is not missed.
type Signals struct {
	venue venue.Adapter
	log   *slog.Logger
	now   func() time.Time

	mu      sync.Mutex
	macross map[string]*strategy.MACross
	boxes   map[string]*strategy.Box
}

// NewSignals wires the signals on a market-data adapter; Run starts them.
func NewSignals(v venue.Adapter, log *slog.Logger) *Signals {
	if log == nil {
		log = slog.Default()
	}
	return &Signals{venue: v, log: log, now: time.Now, macross: make(map[string]*strategy.MACross), boxes: make(map[string]*strategy.Box)}
}

// Run feeds the MA Cross signal for each symbol until ctx ends. It blocks.
func (s *Signals) Run(ctx context.Context, symbols []string) {
	var wg sync.WaitGroup
	for _, sym := range symbols {
		sym = strings.ToUpper(strings.TrimSpace(sym))
		if sym == "" {
			continue
		}
		sig, err := strategy.NewMACross(strategy.DefaultMACross(sym))
		if err != nil {
			s.log.Error("signal not started", "symbol", sym, "err", err)
			continue
		}
		box, err := strategy.NewBox(strategy.DefaultBox(sym))
		if err != nil {
			s.log.Error("signal not started", "symbol", sym, "err", err)
			continue
		}
		s.mu.Lock()
		s.macross[sym] = sig
		s.boxes[sym] = box
		s.mu.Unlock()
		wg.Add(1)
		go func() {
			defer wg.Done()
			s.feed(ctx, sym, sig, box)
		}()
	}
	wg.Wait()
}

// Box returns the box signal's state for a symbol.
func (s *Signals) Box(symbol string) (strategy.BoxState, bool) {
	s.mu.Lock()
	b, ok := s.boxes[strings.ToUpper(strings.TrimSpace(symbol))]
	s.mu.Unlock()
	if !ok {
		return strategy.BoxState{}, false
	}
	return b.State(s.now()), true
}

// MACross returns the signal's state for a symbol.
func (s *Signals) MACross(symbol string) (strategy.MACrossState, bool) {
	s.mu.Lock()
	sig, ok := s.macross[strings.ToUpper(strings.TrimSpace(symbol))]
	s.mu.Unlock()
	if !ok {
		return strategy.MACrossState{}, false
	}
	return sig.State(s.now()), true
}

// signalRetry is the pause before a failed seed or stream is tried again.
const signalRetry = 5 * time.Second

func (s *Signals) feed(ctx context.Context, symbol string, sig *strategy.MACross, box *strategy.Box) {
	cfg := strategy.DefaultMACross(symbol)
	for ctx.Err() == nil {
		if err := s.seed(ctx, symbol, sig, box, cfg); err != nil {
			s.log.Warn("signal seed failed", "symbol", symbol, "err", err)
			sleepCtx(ctx, signalRetry)
			continue
		}
		bars, err := s.venue.StreamCandles(ctx, symbol, cfg.Period)
		if err != nil {
			s.log.Warn("signal stream failed", "symbol", symbol, "err", err)
			sleepCtx(ctx, signalRetry)
			continue
		}
		for b := range bars {
			now := s.now()
			sig.Apply(b, now)
			box.Apply(b, now)
		}
		// The stream closed: the venue connection dropped. Loop to re-seed
		// the gap and subscribe again.
		if ctx.Err() == nil {
			s.log.Info("signal stream ended, reseeding", "symbol", symbol)
			sleepCtx(ctx, time.Second)
		}
	}
}

func (s *Signals) seed(ctx context.Context, symbol string, sig *strategy.MACross, box *strategy.Box, cfg strategy.MACrossConfig) error {
	now := s.now()
	from := now.Add(-time.Duration(cfg.History) * cfg.Period)
	bars, err := s.venue.Candles(ctx, symbol, cfg.Period, from, now)
	if err != nil {
		return err
	}
	sig.Seed(bars, now)
	box.Seed(bars, now)
	s.log.Info("signal seeded", "symbol", symbol, "bars", len(bars))
	return nil
}

func sleepCtx(ctx context.Context, d time.Duration) {
	select {
	case <-ctx.Done():
	case <-time.After(d):
	}
}
