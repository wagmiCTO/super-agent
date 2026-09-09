package platform

import (
	"sort"
	"sync"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/strategy"
)

// Ledger is the record every leaderboard is computed from: each round trip,
// by wallet and by strategy, with its realized result. It is shared by every
// wallet's service — the leaderboard is one table, not one per user.
//
// In memory for now, like the rest of the platform's state; persistence is
// tracked as debt and must land before a leaderboard is settled on-chain.
type Ledger struct {
	now func() time.Time

	mu     sync.Mutex
	open   map[string]openTrade // by wallet + symbol
	closed []Trade
}

type openTrade struct {
	Strategy string
	Symbol   string
	OpenedAt time.Time
}

// Trade is one closed round trip.
type Trade struct {
	Wallet   string
	Strategy string
	Symbol   string
	PnL      fixed.D
	OpenedAt time.Time
	ClosedAt time.Time
}

func NewLedger() *Ledger {
	return &Ledger{now: time.Now, open: make(map[string]openTrade)}
}

func tradeKey(wallet, symbol string) string { return wallet + "/" + symbol }

// Opened notes a position taken under a strategy.
func (l *Ledger) Opened(wallet, strategyID, symbol string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.open[tradeKey(wallet, symbol)] = openTrade{Strategy: strategyID, Symbol: symbol, OpenedAt: l.now()}
}

// Closed settles the round trip for a wallet's position in a symbol. A close
// with no recorded open (a position from before a restart) counts under the
// default strategy.
func (l *Ledger) Closed(wallet, symbol string, pnl fixed.D) {
	l.mu.Lock()
	defer l.mu.Unlock()
	key := tradeKey(wallet, symbol)
	o, ok := l.open[key]
	if !ok {
		o = openTrade{Strategy: strategy.DefaultStrategy, Symbol: symbol, OpenedAt: l.now()}
	}
	delete(l.open, key)
	l.closed = append(l.closed, Trade{Wallet: wallet, Strategy: o.Strategy, Symbol: symbol, PnL: pnl, OpenedAt: o.OpenedAt, ClosedAt: l.now()})
}

// StrategyOf reports which strategy a wallet's open position was taken under.
func (l *Ledger) StrategyOf(wallet, symbol string) (string, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	o, ok := l.open[tradeKey(wallet, symbol)]
	return o.Strategy, ok
}

// Standing is one wallet's line on a strategy's board.
type Standing struct {
	Wallet string
	PnL    fixed.D
	Trades int
}

// Board is one strategy's week.
type Board struct {
	Strategy strategy.Info
	// PnL is what the strategy made for everyone this week — the number
	// people argue about.
	PnL     fixed.D
	Players int
	Trades  int
	// ActiveNow is how many wallets hold a position under the strategy.
	ActiveNow int
	Top       []Standing
}

// Leaderboard is every strategy's board for the week containing now.
type Leaderboard struct {
	WeekStart time.Time
	Boards    []Board
}

// topN is how many standings a board carries.
const topN = 10

// Leaderboard computes the week's boards. Weeks start Monday 00:00 UTC.
func (l *Ledger) Leaderboard() Leaderboard {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now().UTC()
	weekStart := weekStartOf(now)

	type acc struct {
		pnl    fixed.D
		trades int
		by     map[string]*Standing
	}
	accs := make(map[string]*acc, len(strategy.Catalog))
	for _, s := range strategy.Catalog {
		accs[s.ID] = &acc{by: make(map[string]*Standing)}
	}
	for _, t := range l.closed {
		if t.ClosedAt.Before(weekStart) {
			continue
		}
		a, ok := accs[t.Strategy]
		if !ok {
			continue
		}
		a.pnl = a.pnl.Add(t.PnL)
		a.trades++
		st, ok := a.by[t.Wallet]
		if !ok {
			st = &Standing{Wallet: t.Wallet}
			a.by[t.Wallet] = st
		}
		st.PnL = st.PnL.Add(t.PnL)
		st.Trades++
	}
	active := make(map[string]map[string]bool)
	for key, o := range l.open {
		if active[o.Strategy] == nil {
			active[o.Strategy] = make(map[string]bool)
		}
		active[o.Strategy][key[:len(key)-len(o.Symbol)-1]] = true
	}

	out := Leaderboard{WeekStart: weekStart}
	for _, s := range strategy.Catalog {
		a := accs[s.ID]
		b := Board{Strategy: s, PnL: a.pnl, Players: len(a.by), Trades: a.trades, ActiveNow: len(active[s.ID])}
		for _, st := range a.by {
			b.Top = append(b.Top, *st)
		}
		sort.Slice(b.Top, func(i, j int) bool {
			if b.Top[i].PnL != b.Top[j].PnL {
				return b.Top[i].PnL > b.Top[j].PnL
			}
			return b.Top[i].Wallet < b.Top[j].Wallet
		})
		if len(b.Top) > topN {
			b.Top = b.Top[:topN]
		}
		out.Boards = append(out.Boards, b)
	}
	return out
}

func weekStartOf(t time.Time) time.Time {
	t = t.UTC()
	days := (int(t.Weekday()) + 6) % 7 // Monday = 0
	d := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	return d.AddDate(0, 0, -days)
}
