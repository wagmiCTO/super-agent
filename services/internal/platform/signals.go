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

// SignalPeriods are the bar sizes the signals run on: the chart's own, so
// what the screen shows on a timeframe is what the strategy read on it.
var SignalPeriods = []time.Duration{time.Minute, 5 * time.Minute, 15 * time.Minute, 30 * time.Minute, time.Hour}

// SignalPeriod reports whether a bar size is one the signals run on.
func SignalPeriod(p time.Duration) bool {
	for _, sp := range SignalPeriods {
		if sp == p {
			return true
		}
	}
	return false
}

// windowBars is how long a signal stays lit, in bars of its timeframe: a
// cross on the minute chart is offered for three minutes, one on the
// hourly chart for three hours. A signal that lasts a second is not one a
// thumb can take.
const windowBars = 3

// historyBars is how many closed bars each timeframe keeps: the minute
// feed keeps two hours for the chart and the risk report, the others what
// the averages and the index need with room to spare.
func historyBars(period time.Duration) int {
	if period <= time.Minute {
		return 120
	}
	return 60
}

// feedKey names one signal: a market on a timeframe.
type feedKey struct {
	symbol string
	period time.Duration
}

// feedSet is every strategy's signal on one market and timeframe. They read
// the same bars, so they are seeded and fed together.
type feedSet struct {
	macross  *strategy.MACross
	rsi      *strategy.RSI
	donchian *strategy.Donchian
	orb      *strategy.ORB
}

// newFeedSet builds the signals for a market on a timeframe with the
// platform's defaults, the window and history scaled to the bar size.
func newFeedSet(symbol string, p time.Duration) (*feedSet, error) {
	mc := strategy.DefaultMACross(symbol)
	mc.Period, mc.Window, mc.History = p, windowBars*p, historyBars(p)
	macross, err := strategy.NewMACross(mc)
	if err != nil {
		return nil, err
	}
	rc := strategy.DefaultRSI(symbol)
	rc.Period, rc.Window, rc.History = p, windowBars*p, historyBars(p)
	rsi, err := strategy.NewRSI(rc)
	if err != nil {
		return nil, err
	}
	dc := strategy.DefaultDonchian(symbol)
	dc.Period, dc.Window, dc.History = p, windowBars*p, historyBars(p)
	donchian, err := strategy.NewDonchian(dc)
	if err != nil {
		return nil, err
	}
	oc := strategy.DefaultORB(symbol)
	oc.Period, oc.Window, oc.History = p, windowBars*p, historyBars(p)
	orb, err := strategy.NewORB(oc)
	if err != nil {
		return nil, err
	}
	return &feedSet{macross: macross, rsi: rsi, donchian: donchian, orb: orb}, nil
}

// lookback is how much closed history the set's seed needs: what the chart
// keeps, or what the opening range needs to know the current session,
// whichever reaches further back. Each signal trims to its own history.
func (f *feedSet) lookback(p time.Duration) time.Duration {
	d := time.Duration(historyBars(p)) * p
	if orb := strategy.DefaultORB("x"); orb.Lookback()+p > d {
		return orb.Lookback() + p
	}
	return d
}

func (f *feedSet) seed(bars []venue.Candle, now time.Time) {
	f.macross.Seed(bars, now)
	f.rsi.Seed(bars, now)
	f.donchian.Seed(bars, now)
	f.orb.Seed(bars, now)
}

func (f *feedSet) apply(b venue.Candle, now time.Time) {
	f.macross.Apply(b, now)
	f.rsi.Apply(b, now)
	f.donchian.Apply(b, now)
	f.orb.Apply(b, now)
}

// Signals keeps the strategies' signals alive on one market-data connection,
// shared by every wallet: a signal is about the market, not about a user.
// Each symbol has one minute-bar stream; the larger bars are built from it,
// so five timeframes cost the venue one subscription. Every timeframe is
// seeded from candle history, then fed live, and re-seeded whenever the
// stream has to be reopened so a cross during the gap is not missed.
type Signals struct {
	venue venue.Adapter
	log   *slog.Logger
	now   func() time.Time

	mu    sync.Mutex
	feeds map[feedKey]*feedSet
	// stop ends a symbol's feed; one per symbol that is running.
	stop map[string]context.CancelFunc

	// Seeds are paced across every market: thirty-five history reads at
	// start are what a rate-limited venue notices. seedGap is the least
	// time between two.
	paceMu   sync.Mutex
	nextSeed time.Time
	seedGap  time.Duration
}

// NewSignals wires the signals on a market-data adapter; Run starts them.
func NewSignals(v venue.Adapter, log *slog.Logger) *Signals {
	if log == nil {
		log = slog.Default()
	}
	return &Signals{venue: v, log: log, now: time.Now, feeds: make(map[feedKey]*feedSet), stop: make(map[string]context.CancelFunc), seedGap: 250 * time.Millisecond}
}

// Run feeds the signals for each symbol until ctx ends. It blocks. The
// list may change afterwards through Ensure.
func (s *Signals) Run(ctx context.Context, symbols []string) {
	s.Ensure(ctx, symbols)
	<-ctx.Done()
}

// Ensure makes the running feeds match the list: a market that is new
// gets its signals seeded and fed, one that is gone has its feed stopped
// and its state dropped, so a screen asking for it is told there is none.
func (s *Signals) Ensure(ctx context.Context, symbols []string) {
	want := map[string]bool{}
	for _, sym := range symbols {
		sym = strings.ToUpper(strings.TrimSpace(sym))
		if sym != "" {
			want[sym] = true
		}
	}
	s.mu.Lock()
	for sym, cancel := range s.stop {
		if !want[sym] {
			cancel()
			delete(s.stop, sym)
			for _, p := range SignalPeriods {
				delete(s.feeds, feedKey{sym, p})
			}
			s.log.Info("signal stopped: market gone", "symbol", sym)
		}
	}
	s.mu.Unlock()
	for sym := range want {
		s.mu.Lock()
		_, running := s.stop[sym]
		s.mu.Unlock()
		if running {
			continue
		}
		sets := make(map[time.Duration]*feedSet, len(SignalPeriods))
		ok := true
		for _, p := range SignalPeriods {
			set, err := newFeedSet(sym, p)
			if err != nil {
				s.log.Error("signal not started", "symbol", sym, "period", p, "err", err)
				ok = false
				break
			}
			sets[p] = set
		}
		if !ok {
			continue
		}
		feedCtx, cancel := context.WithCancel(ctx)
		s.mu.Lock()
		for p, set := range sets {
			s.feeds[feedKey{sym, p}] = set
		}
		s.stop[sym] = cancel
		s.mu.Unlock()
		go s.feed(feedCtx, sym, sets)
	}
}

// set is the signals for a symbol on a timeframe, if the market is fed.
func (s *Signals) set(symbol string, period time.Duration) (*feedSet, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, ok := s.feeds[feedKey{strings.ToUpper(strings.TrimSpace(symbol)), period}]
	return f, ok
}

// RSI returns the RSI signal's state for a symbol on the minute chart.
func (s *Signals) RSI(symbol string) (strategy.RSIState, bool) {
	return s.RSIAt(symbol, time.Minute)
}

// RSIAt returns the RSI signal's state for a symbol on a timeframe.
func (s *Signals) RSIAt(symbol string, period time.Duration) (strategy.RSIState, bool) {
	f, ok := s.set(symbol, period)
	if !ok {
		return strategy.RSIState{}, false
	}
	return f.rsi.State(s.now()), true
}

// MACross returns the signal's state for a symbol on the minute chart.
func (s *Signals) MACross(symbol string) (strategy.MACrossState, bool) {
	return s.MACrossAt(symbol, time.Minute)
}

// MACrossAt returns the signal's state for a symbol on a timeframe.
func (s *Signals) MACrossAt(symbol string, period time.Duration) (strategy.MACrossState, bool) {
	f, ok := s.set(symbol, period)
	if !ok {
		return strategy.MACrossState{}, false
	}
	return f.macross.State(s.now()), true
}

// DonchianAt returns the channel breakout's state for a symbol on a timeframe.
func (s *Signals) DonchianAt(symbol string, period time.Duration) (strategy.DonchianState, bool) {
	f, ok := s.set(symbol, period)
	if !ok {
		return strategy.DonchianState{}, false
	}
	return f.donchian.State(s.now()), true
}

// ORBAt returns the opening range breakout's state for a symbol on a timeframe.
func (s *Signals) ORBAt(symbol string, period time.Duration) (strategy.ORBState, bool) {
	f, ok := s.set(symbol, period)
	if !ok {
		return strategy.ORBState{}, false
	}
	return f.orb.State(s.now()), true
}

// signalRetry is the pause before a failed seed or stream is tried again.
const signalRetry = 5 * time.Second

func (s *Signals) feed(ctx context.Context, symbol string, sets map[time.Duration]*feedSet) {
	for ctx.Err() == nil {
		if err := s.seedAll(ctx, symbol, sets); err != nil {
			s.log.Warn("signal seed failed", "symbol", symbol, "err", err)
			sleepCtx(ctx, signalRetry)
			continue
		}
		bars, err := s.venue.StreamCandles(ctx, symbol, time.Minute)
		if err != nil {
			s.log.Warn("signal stream failed", "symbol", symbol, "err", err)
			sleepCtx(ctx, signalRetry)
			continue
		}
		// The larger bars are built from the minute stream, one builder
		// per timeframe; a re-seed starts them over.
		builders := map[time.Duration]*barBuilder{}
		for _, p := range SignalPeriods {
			if p > time.Minute {
				builders[p] = &barBuilder{period: p}
			}
		}
		for b := range bars {
			now := s.now()
			sets[time.Minute].apply(b, now)
			for p, bld := range builders {
				for _, big := range bld.add(b) {
					sets[p].apply(big, now)
				}
			}
		}
		// The stream closed: the venue connection dropped. Loop to re-seed
		// the gap and subscribe again.
		if ctx.Err() == nil {
			s.log.Info("signal stream ended, reseeding", "symbol", symbol)
			sleepCtx(ctx, time.Second)
		}
	}
}

// seedAll reads each timeframe's history, paced.
func (s *Signals) seedAll(ctx context.Context, symbol string, sets map[time.Duration]*feedSet) error {
	for _, p := range SignalPeriods {
		if err := s.seed(ctx, symbol, p, sets[p]); err != nil {
			return err
		}
	}
	return nil
}

func (s *Signals) seed(ctx context.Context, symbol string, period time.Duration, set *feedSet) error {
	s.pace(ctx)
	now := s.now()
	from := now.Add(-set.lookback(period))
	bars, err := s.venue.Candles(ctx, symbol, period, from, now)
	if err != nil {
		return err
	}
	set.seed(bars, now)
	s.log.Info("signal seeded", "symbol", symbol, "period", period, "bars", len(bars))
	return nil
}

// pace waits its turn: one history read per seedGap across the process.
func (s *Signals) pace(ctx context.Context) {
	s.paceMu.Lock()
	wait := time.Until(s.nextSeed)
	if wait < 0 {
		wait = 0
	}
	s.nextSeed = time.Now().Add(wait + s.seedGap)
	s.paceMu.Unlock()
	if wait > 0 {
		sleepCtx(ctx, wait)
	}
}

// barBuilder folds minute bars into bars of a larger period. A minute bar
// that opens in a new bucket closes the bucket before it: the closed bar
// is returned first, then the new bucket as it is forming. A minute bar
// repeated while it forms updates the bucket in place.
type barBuilder struct {
	period time.Duration
	cur    *venue.Candle
	// lastMinute is the open time of the last minute bar folded in, so a
	// forming bar's repeats replace rather than add.
	lastMinute time.Time
	lastO      venue.Candle
}

func (b *barBuilder) add(m venue.Candle) []venue.Candle {
	bucket := m.Open.Truncate(b.period)
	var out []venue.Candle
	if b.cur != nil && !b.cur.Open.Equal(bucket) {
		closed := *b.cur
		out = append(out, closed)
		b.cur = nil
	}
	if b.cur == nil {
		c := venue.Candle{Open: bucket, Period: b.period, O: m.O, H: m.H, L: m.L, C: m.C, Volume: m.Volume, Trades: m.Trades}
		b.cur = &c
	} else {
		if m.Open.Equal(b.lastMinute) {
			// The same minute again: take back what it added last time.
			b.cur.Volume = b.cur.Volume.Sub(b.lastO.Volume)
			b.cur.Trades -= b.lastO.Trades
		}
		if m.H.Cmp(b.cur.H) > 0 {
			b.cur.H = m.H
		}
		if m.L.Cmp(b.cur.L) < 0 || b.cur.L.IsZero() {
			b.cur.L = m.L
		}
		b.cur.C = m.C
		b.cur.Volume = b.cur.Volume.Add(m.Volume)
		b.cur.Trades += m.Trades
	}
	b.lastMinute, b.lastO = m.Open, m
	forming := *b.cur
	return append(out, forming)
}

func sleepCtx(ctx context.Context, d time.Duration) {
	select {
	case <-ctx.Done():
	case <-time.After(d):
	}
}
