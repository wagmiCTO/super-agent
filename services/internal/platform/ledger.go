package platform

import (
	"context"
	"log/slog"
	"sort"
	"strings"
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
	open     map[string]openTrade // by account + symbol
	closed   []Trade
	wallets  map[string]bool
	onClosed []func(Trade)
}

type openTrade struct {
	// Terms are what the position was made of: the wallet's own money in
	// it, the leverage on top, and where the stop stood.
	Terms store.Terms
	// Wallet is the address the round trip belongs to. The map is keyed by
	// the policy account, which is "<wallet>/<strategy>" for a strategy's
	// own key — one wallet can hold the same symbol under two strategies,
	// so the key cannot be the wallet, and the wallet cannot be recovered
	// from the key by cutting at the first slash.
	Wallet   string
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

func tradeKey(account, symbol string) string { return account + "/" + symbol }

// TradeRef ties a round trip to the venue: the hash of its order ids.
func TradeRef(openOrderID, closeOrderID string) [32]byte {
	return eip712.Keccak256([]byte(openOrderID + "|" + closeOrderID))
}

// Opened notes a position taken under a strategy; orderID is the venue's id
// of the opening order and f what it filled.
//
// `account` is the policy account the position is held under and `wallet`
// the address it belongs to — the same wallet trading two strategies has two
// accounts and one line on the board.
func (l *Ledger) Opened(account, wallet, strategyID, symbol, orderID string, f store.Fill, terms store.Terms) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.open[tradeKey(account, symbol)] = openTrade{Wallet: wallet, Strategy: strategyID, Symbol: symbol, OrderID: orderID, Fill: f, Terms: terms, OpenedAt: l.now()}
	l.wallets[wallet] = true
	if l.journal != nil {
		if err := l.journal.TradeOpened(context.Background(), wallet, strategyID, symbol, orderID, f, terms, l.now()); err != nil {
			slog.Warn("ledger: open not journaled", "wallet", wallet, "err", err)
		}
	}
}

// Closed settles the round trip for a wallet's position in a symbol. A close
// with no recorded open (a position from before a restart) counts under the
// default strategy. closeOrderID is the venue's id of the closing order and
// f what it filled.
func (l *Ledger) Closed(account, wallet, symbol string, pnl fixed.D, closeOrderID string, f store.Fill, reason string, ex store.Excursion) {
	l.mu.Lock()
	key := tradeKey(account, symbol)
	o, ok := l.open[key]
	if !ok {
		o = openTrade{Wallet: wallet, Strategy: strategy.DefaultStrategy, Symbol: symbol, OpenedAt: l.now()}
	}
	delete(l.open, key)
	t := Trade{Wallet: wallet, Strategy: o.Strategy, Symbol: symbol, PnL: pnl, OpenedAt: o.OpenedAt, ClosedAt: l.now(), Ref: TradeRef(o.OrderID, closeOrderID), Entry: o.Fill, Exit: f, Reason: reason}
	if l.journal != nil {
		// The journal knows the strategy of a position opened before this
		// process started; memory may not.
		if ct, err := l.journal.TradeClosed(context.Background(), wallet, symbol, o.Strategy, closeOrderID, f, pnl, reason, ex, t.ClosedAt); err != nil {
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

// TradesPage is Trades one page at a time. Memory has no pages: it holds
// what this process has seen, which is one screen's worth at most, so it
// answers the first page and says there is no next.
func (l *Ledger) TradesPage(ctx context.Context, q store.TradeQuery) ([]store.ClosedTrade, store.TradeCursor, error) {
	if l.journal != nil {
		return l.journal.TradesPage(ctx, q)
	}
	if !q.After.IsZero() {
		return nil, store.TradeCursor{}, nil
	}
	out, err := l.Trades(ctx, q.Wallet, q.Symbol, q.Strategy, q.Limit)
	if q.ClosedOnly {
		kept := out[:0]
		for _, t := range out {
			if !t.ClosedAt.IsZero() {
				kept = append(kept, t)
			}
		}
		out = kept
	}
	return out, store.TradeCursor{}, err
}

// Trade reads one journaled round trip of a wallet's. Without a journal
// there are no ids to read one by.
func (l *Ledger) Trade(ctx context.Context, wallet string, id int64) (store.ClosedTrade, bool, error) {
	if l.journal == nil {
		return store.ClosedTrade{}, false, nil
	}
	return l.journal.TradeByID(ctx, wallet, id)
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
		if t.Wallet != wallet || (symbol != "" && t.Symbol != symbol) || (strategyID != "" && t.Strategy != strategyID) {
			continue
		}
		out = append(out, store.ClosedTrade{Wallet: t.Wallet, Strategy: t.Strategy, Symbol: t.Symbol, Side: t.Entry.Side, Size: t.Entry.Size, EntryPrice: t.Entry.Price, ExitPrice: t.Exit.Price, EntryFee: t.Entry.Fee, ExitFee: t.Exit.Fee, PnL: t.PnL, CloseReason: t.Reason, OpenedAt: t.OpenedAt, ClosedAt: t.ClosedAt})
	}
	for _, o := range l.open {
		if o.Wallet != wallet || (symbol != "" && o.Symbol != symbol) || (strategyID != "" && o.Strategy != strategyID) || len(out) >= limit {
			continue
		}
		out = append([]store.ClosedTrade{{Wallet: o.Wallet, Strategy: o.Strategy, Symbol: o.Symbol, Side: o.Fill.Side, Size: o.Fill.Size, EntryPrice: o.Fill.Price, EntryFee: o.Fill.Fee, OpenedAt: o.OpenedAt}}, out...)
	}
	return out, nil
}

// StrategyOf reports which strategy an account's open position was taken
// under.
func (l *Ledger) StrategyOf(account, symbol string) (string, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	o, ok := l.open[tradeKey(account, symbol)]
	return o.Strategy, ok
}

// Holder reports which strategy holds a wallet's open position in a
// symbol: what this process saw opened, or, for a position from before it
// started, what the journal has. False for a position the platform never
// opened.
func (l *Ledger) Holder(ctx context.Context, wallet, symbol string) (string, bool) {
	l.mu.Lock()
	for _, o := range l.open {
		if o.Wallet == wallet && o.Symbol == symbol {
			l.mu.Unlock()
			return o.Strategy, true
		}
	}
	journal := l.journal
	l.mu.Unlock()
	if journal == nil {
		return "", false
	}
	id, ok, err := journal.OpenStrategy(ctx, wallet, symbol)
	if err != nil {
		slog.Warn("ledger: open strategy not read", "wallet", wallet, "symbol", symbol, "err", err)
		return "", false
	}
	return id, ok
}

// Standing is one wallet's line on a strategy's board.
type Standing struct {
	Wallet string
	PnL    fixed.D
	Trades int
	// Volume is what the wallet opened, in collateral units.
	Volume fixed.D
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

// Leaderboard is every strategy's board over one stretch of time.
type Leaderboard struct {
	// WeekStart is the Monday of the week containing now, whatever the
	// period: the prize pool and the deadline are weekly either way.
	WeekStart time.Time
	// Period is "week" or "all".
	Period string
	// Source is "journal" (Postgres) or "memory".
	Source string
	Boards []Board
}

// topN is how many standings a board carries.
const topN = 10

// epoch is where "all time" starts. Before the first trade by decades, and
// a real timestamp rather than the zero time, which not every database
// driver takes kindly to.
var epoch = time.Unix(0, 0).UTC()

// Leaderboard computes the week's boards. Weeks start Monday 00:00 UTC.
func (l *Ledger) Leaderboard() Leaderboard { return l.boards(weekStartOf(l.now()), "week") }

// AllTime computes the same boards over every trade on record. The prize is
// weekly, so this board pays nothing — it is the standing of the house.
func (l *Ledger) AllTime() Leaderboard { return l.boards(epoch, "all") }

// StandingsPage is one board, one page at a time, ordered by volume, with
// how many wallets are on it altogether. `strategy` empty means every strategy at once, and
// then a wallet counts once however many it played — which is the honest
// answer to "how many players", and the reason this does not add up the
// per-board counts.
//
// Without a journal there are no pages: memory answers the first one from
// what this process has seen.
func (l *Ledger) StandingsPage(period, strategy string, limit, offset int) ([]Standing, int, error) {
	weekStart := weekStartOf(l.now())
	since := weekStart
	if period == "all" {
		since = epoch
	}
	until := weekStart.AddDate(0, 0, 7)
	if l.journal != nil {
		rows, total, err := l.journal.StandingsPage(context.Background(), strategy, since, until, limit, offset)
		if err == nil {
			out := make([]Standing, 0, len(rows))
			for _, r := range rows {
				out = append(out, Standing{Wallet: r.Wallet, PnL: r.PnL, Trades: r.Trades, Volume: r.Volume})
			}
			return out, total, nil
		}
		slog.Warn("ledger: standings not read from the journal, serving memory", "err", err)
	}
	return l.standingsFromMemory(since, strategy, limit, offset)
}

// StandingOf is a wallet's own line on a board, with its rank by volume.
// Zero rank means it is not on the board.
func (l *Ledger) StandingOf(period, strategy, wallet string) (Standing, int, error) {
	weekStart := weekStartOf(l.now())
	since := weekStart
	if period == "all" {
		since = epoch
	}
	until := weekStart.AddDate(0, 0, 7)
	if l.journal != nil {
		st, rank, err := l.journal.StandingOf(context.Background(), strategy, since, until, wallet)
		if err == nil {
			return Standing{Wallet: st.Wallet, PnL: st.PnL, Trades: st.Trades, Volume: st.Volume}, rank, nil
		}
		slog.Warn("ledger: standing not read from the journal, serving memory", "err", err)
	}
	all, _, err := l.standingsFromMemory(since, strategy, 1<<30, 0)
	if err != nil {
		return Standing{}, 0, err
	}
	for i, st := range all {
		if strings.EqualFold(st.Wallet, wallet) {
			return st, i + 1, nil
		}
	}
	return Standing{}, 0, nil
}

func (l *Ledger) standingsFromMemory(since time.Time, strategyID string, limit, offset int) ([]Standing, int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	by := map[string]*Standing{}
	for _, t := range l.closed {
		if t.ClosedAt.Before(since) || (strategyID != "" && t.Strategy != strategyID) {
			continue
		}
		st := by[t.Wallet]
		if st == nil {
			st = &Standing{Wallet: t.Wallet}
			by[t.Wallet] = st
		}
		st.PnL = st.PnL.Add(t.PnL)
		st.Trades++
		st.Volume = st.Volume.Add(t.Entry.Size.Mul(t.Entry.Price))
	}
	all := make([]Standing, 0, len(by))
	for _, st := range by {
		all = append(all, *st)
	}
	// By volume, as the journal orders it.
	sort.Slice(all, func(i, j int) bool {
		if all[i].Volume != all[j].Volume {
			return all[i].Volume > all[j].Volume
		}
		return all[i].Wallet < all[j].Wallet
	})
	total := len(all)
	if offset >= total {
		return nil, total, nil
	}
	end := min(offset+limit, total)
	return all[offset:end], total, nil
}

// boards reads the standings for trades closed at or after `since`. With a
// journal they come from Postgres; memory answers only while the database
// is unreachable.
func (l *Ledger) boards(since time.Time, period string) Leaderboard {
	weekStart := weekStartOf(l.now())
	if l.journal != nil {
		rows, err := l.journal.Boards(context.Background(), since, weekStart.AddDate(0, 0, 7), topN)
		if err == nil {
			out := Leaderboard{WeekStart: weekStart, Period: period, Source: "journal"}
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
	return l.leaderboardFromMemory(since, period)
}

func (l *Ledger) leaderboardFromMemory(since time.Time, period string) Leaderboard {
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
		if t.ClosedAt.Before(since) {
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
	for _, o := range l.open {
		if active[o.Strategy] == nil {
			active[o.Strategy] = make(map[string]bool)
		}
		active[o.Strategy][o.Wallet] = true
	}

	out := Leaderboard{WeekStart: weekStart, Period: period, Source: "memory"}
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
