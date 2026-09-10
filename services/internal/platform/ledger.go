package platform

import (
	"context"
	"log/slog"
	"sort"
	"sync"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/eip712"
	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/store"
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
	// journal, when set, is the system of record; memory is a write-through
	// cache that also answers while the database is unreachable.
	journal *store.Store

	mu       sync.Mutex
	open     map[string]openTrade // by wallet + symbol
	closed   []Trade
	wallets  map[string]bool
	onClosed []func(Trade)
}

type openTrade struct {
	Strategy string
	Symbol   string
	OrderID  string
	Fill     store.Fill
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
	// Ref ties the round trip to the venue: the hash of its order ids.
	Ref [32]byte
	// Entry and Exit are the fills, for the chart; Reason says who closed.
	Entry, Exit store.Fill
	Reason      string
}

func NewLedger() *Ledger {
	return &Ledger{now: time.Now, open: make(map[string]openTrade), wallets: make(map[string]bool)}
}

// NewJournaledLedger writes every round trip to Postgres and computes the
// boards from it; memory stays as a cache.
func NewJournaledLedger(st *store.Store) *Ledger {
	l := NewLedger()
	l.journal = st
	return l
}

// OnClosed registers a listener for every closed round trip — settlement
// on-chain, for one. Listeners run synchronously; they must be quick.
func (l *Ledger) OnClosed(fn func(Trade)) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.onClosed = append(l.onClosed, fn)
}

// Wallets lists every wallet that has traded, for readers that cannot
// enumerate on their own (the contract).
func (l *Ledger) Wallets() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := make([]string, 0, len(l.wallets))
	for w := range l.wallets {
		out = append(out, w)
	}
	sort.Strings(out)
	return out
}

func tradeKey(wallet, symbol string) string { return wallet + "/" + symbol }

// TradeRef ties a round trip to the venue: the hash of its order ids.
func TradeRef(openOrderID, closeOrderID string) [32]byte {
	return eip712.Keccak256([]byte(openOrderID + "|" + closeOrderID))
}

// Opened notes a position taken under a strategy; orderID is the venue's id
// of the opening order and f what it filled.
func (l *Ledger) Opened(wallet, strategyID, symbol, orderID string, f store.Fill) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.open[tradeKey(wallet, symbol)] = openTrade{Strategy: strategyID, Symbol: symbol, OrderID: orderID, Fill: f, OpenedAt: l.now()}
	l.wallets[wallet] = true
	if l.journal != nil {
		if err := l.journal.TradeOpened(context.Background(), wallet, strategyID, symbol, orderID, f, l.now()); err != nil {
			slog.Warn("ledger: open not journaled", "wallet", wallet, "err", err)
		}
	}
}

// Closed settles the round trip for a wallet's position in a symbol. A close
// with no recorded open (a position from before a restart) counts under the
// default strategy. closeOrderID is the venue's id of the closing order and
// f what it filled.
func (l *Ledger) Closed(wallet, symbol string, pnl fixed.D, closeOrderID string, f store.Fill, reason string) {
	l.mu.Lock()
	key := tradeKey(wallet, symbol)
	o, ok := l.open[key]
	if !ok {
		o = openTrade{Strategy: strategy.DefaultStrategy, Symbol: symbol, OpenedAt: l.now()}
	}
	delete(l.open, key)
	t := Trade{Wallet: wallet, Strategy: o.Strategy, Symbol: symbol, PnL: pnl, OpenedAt: o.OpenedAt, ClosedAt: l.now(), Ref: TradeRef(o.OrderID, closeOrderID), Entry: o.Fill, Exit: f, Reason: reason}
	if l.journal != nil {
		// The journal knows the strategy of a position opened before this
		// process started; memory may not.
		if ct, err := l.journal.TradeClosed(context.Background(), wallet, symbol, o.Strategy, closeOrderID, f, pnl, reason, t.ClosedAt); err != nil {
			slog.Warn("ledger: close not journaled", "wallet", wallet, "err", err)
		} else {
			t.Strategy, t.OpenedAt, t.Ref = ct.Strategy, ct.OpenedAt, TradeRef(ct.OpenOrderID, closeOrderID)
			t.Entry = store.Fill{Side: ct.Side, Size: ct.Size, Price: ct.EntryPrice}
		}
	}
	l.closed = append(l.closed, t)
	l.wallets[wallet] = true
	listeners := append([]func(Trade){}, l.onClosed...)
	l.mu.Unlock()
	for _, fn := range listeners {
		fn(t)
	}
}

// Trades lists a wallet's round trips in a symbol, newest first. Without a
// journal, only what this process has seen.
func (l *Ledger) Trades(ctx context.Context, wallet, symbol, strategyID string, limit int) ([]store.ClosedTrade, error) {
	if l.journal != nil {
		return l.journal.Trades(ctx, wallet, symbol, strategyID, limit)
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	var out []store.ClosedTrade
	for i := len(l.closed) - 1; i >= 0 && len(out) < limit; i-- {
		t := l.closed[i]
		if t.Wallet != wallet || t.Symbol != symbol || (strategyID != "" && t.Strategy != strategyID) {
			continue
		}
		out = append(out, store.ClosedTrade{Wallet: t.Wallet, Strategy: t.Strategy, Symbol: t.Symbol, Side: t.Entry.Side, Size: t.Entry.Size, EntryPrice: t.Entry.Price, ExitPrice: t.Exit.Price, EntryFee: t.Entry.Fee, ExitFee: t.Exit.Fee, PnL: t.PnL, CloseReason: t.Reason, OpenedAt: t.OpenedAt, ClosedAt: t.ClosedAt})
	}
	if o, ok := l.open[tradeKey(wallet, symbol)]; ok && len(out) < limit && (strategyID == "" || o.Strategy == strategyID) {
		out = append([]store.ClosedTrade{{Wallet: wallet, Strategy: o.Strategy, Symbol: symbol, Side: o.Fill.Side, Size: o.Fill.Size, EntryPrice: o.Fill.Price, EntryFee: o.Fill.Fee, OpenedAt: o.OpenedAt}}, out...)
	}
	return out, nil
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
	// Source is "journal" (Postgres) or "memory".
	Source string
	Boards []Board
}

// topN is how many standings a board carries.
const topN = 10

// Leaderboard computes the week's boards. Weeks start Monday 00:00 UTC.
// With a journal the boards come from Postgres; memory answers only while
// the database is unreachable.
func (l *Ledger) Leaderboard() Leaderboard {
	if l.journal != nil {
		weekStart := weekStartOf(l.now())
		rows, err := l.journal.Boards(context.Background(), weekStart, weekStart.AddDate(0, 0, 7), topN)
		if err == nil {
			out := Leaderboard{WeekStart: weekStart, Source: "journal"}
			for _, s := range strategy.Catalog {
				b := Board{Strategy: s}
				if r := rows[s.ID]; r != nil {
					b.PnL, b.Players, b.Trades, b.ActiveNow = r.PnL, r.Players, r.Trades, r.ActiveNow
					for _, st := range r.Top {
						b.Top = append(b.Top, Standing{Wallet: st.Wallet, PnL: st.PnL, Trades: st.Trades})
					}
				}
				out.Boards = append(out.Boards, b)
			}
			return out
		}
		slog.Warn("ledger: boards not read from the journal, serving memory", "err", err)
	}
	return l.leaderboardFromMemory()
}

func (l *Ledger) leaderboardFromMemory() Leaderboard {
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

	out := Leaderboard{WeekStart: weekStart, Source: "memory"}
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
