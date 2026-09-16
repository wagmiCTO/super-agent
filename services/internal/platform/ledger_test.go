package platform

import (
	"context"
	"testing"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/store"
)

// The two calls every test here makes: a position taken under a strategy
// key, and the same one closed. The policy account is "<wallet>/<strategy>";
// the board knows the wallet.
func opened(l *Ledger, wallet, strategyID, symbol string) {
	l.Opened(wallet+"/"+strategyID, wallet, strategyID, symbol, "o", store.Fill{}, store.Terms{})
}

func closed(l *Ledger, wallet, strategyID, symbol string, pnl int) {
	l.Closed(wallet+"/"+strategyID, wallet, symbol, fixed.FromInt(int64(pnl)), "c", store.Fill{}, "manual", store.Excursion{})
}

// The week's board per strategy: who is up, what the strategy made for
// everyone, who is in a position right now. Last week's trades do not count.
func TestLeaderboardByStrategyAndWeek(t *testing.T) {
	l := NewLedger()
	now := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC) // a Thursday
	l.now = func() time.Time { return now }

	// Last week: must not count.
	now = time.Date(2026, 9, 6, 12, 0, 0, 0, time.UTC)
	opened(l, "0xaaa", "direction", "MON")
	closed(l, "0xaaa", "direction", "MON", 100)

	now = time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	opened(l, "0xaaa", "direction", "MON")
	closed(l, "0xaaa", "direction", "MON", 3)
	opened(l, "0xbbb", "direction", "MON")
	closed(l, "0xbbb", "direction", "MON", -1)
	opened(l, "0xbbb", "ma-cross", "MON")
	closed(l, "0xbbb", "ma-cross", "MON", 5)
	// An untagged position from before a restart counts as Direction.
	l.Closed("0xccc", "0xccc", "MON", fixed.FromInt(1), "c", store.Fill{}, "manual", store.Excursion{})
	// Open right now under MA Cross.
	opened(l, "0xaaa", "ma-cross", "MON")

	now = time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)
	lb := l.Leaderboard()
	if !lb.WeekStart.Equal(time.Date(2026, 9, 7, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("week start = %v", lb.WeekStart)
	}
	if len(lb.Boards) != 3 {
		t.Fatalf("boards = %d", len(lb.Boards))
	}
	dir, ma := lb.Boards[0], lb.Boards[1]
	if dir.Strategy.ID != "direction" || dir.PnL != fixed.FromInt(3) || dir.Players != 3 || dir.Trades != 3 || dir.ActiveNow != 0 {
		t.Errorf("direction board = %+v", dir)
	}
	if len(dir.Top) != 3 || dir.Top[0].Wallet != "0xaaa" || dir.Top[2].Wallet != "0xbbb" {
		t.Errorf("direction top = %+v", dir.Top)
	}
	if ma.Strategy.ID != "ma-cross" || ma.PnL != fixed.FromInt(5) || ma.Players != 1 || ma.ActiveNow != 1 {
		t.Errorf("ma-cross board = %+v", ma)
	}
	if s, ok := l.StrategyOf("0xaaa/ma-cross", "MON"); !ok || s != "ma-cross" {
		t.Errorf("StrategyOf = %q, %v", s, ok)
	}
}

// The board knows wallets, not policy accounts.
//
// A strategy's own key trades under "<wallet>/<strategy>", and that string
// used to land in the journal's wallet column: the board showed a name
// nobody recognises, one wallet counted once per strategy, and the
// settlement — which requires an address it can pay — skipped every line, so
// no prize could ever be claimed. One wallet on two strategies is one line
// on each board, under its address, and a position open under one of them
// does not disturb the other.
func TestBoardKnowsWalletsNotPolicyAccounts(t *testing.T) {
	l := NewLedger()
	now := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC) // a Thursday
	l.now = func() time.Time { return now }

	opened(l, "0xaaa", "direction", "MON")
	opened(l, "0xaaa", "ma-cross", "MON") // the same symbol, the other key
	closed(l, "0xaaa", "direction", "MON", 4)

	lb := l.Leaderboard()
	dir, ma := lb.Boards[0], lb.Boards[1]
	if len(dir.Top) != 1 || dir.Top[0].Wallet != "0xaaa" {
		t.Fatalf("direction top = %+v", dir.Top)
	}
	// Closing the one leaves the other open, and it is the other board that
	// has somebody in it right now.
	if dir.ActiveNow != 0 || ma.ActiveNow != 1 {
		t.Errorf("active now = %d, %d", dir.ActiveNow, ma.ActiveNow)
	}
	if s, ok := l.StrategyOf("0xaaa/ma-cross", "MON"); !ok || s != "ma-cross" {
		t.Errorf("StrategyOf = %q, %v", s, ok)
	}
	// And the wallet is listed once, by address — it is what the prize
	// contract pays.
	if ws := l.Wallets(); len(ws) != 1 || ws[0] != "0xaaa" {
		t.Errorf("wallets = %v", ws)
	}
}

// All time is the same board over every trade on record: last week's 100
// comes back, and the week's board is left alone.
func TestAllTimeCountsEveryWeek(t *testing.T) {
	l := NewLedger()
	now := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC) // a Thursday
	l.now = func() time.Time { return now }

	now = time.Date(2026, 9, 6, 12, 0, 0, 0, time.UTC) // last week
	opened(l, "0xaaa", "direction", "MON")
	closed(l, "0xaaa", "direction", "MON", 100)

	now = time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC) // this week
	opened(l, "0xbbb", "direction", "MON")
	closed(l, "0xbbb", "direction", "MON", 3)

	now = time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)
	week, all := l.Leaderboard(), l.AllTime()
	if week.Period != "week" || all.Period != "all" {
		t.Fatalf("periods = %q, %q", week.Period, all.Period)
	}
	// The week the prize belongs to is the same on both boards.
	if !all.WeekStart.Equal(week.WeekStart) {
		t.Errorf("all-time week start = %v, want %v", all.WeekStart, week.WeekStart)
	}
	if b := week.Boards[0]; b.PnL != fixed.FromInt(3) || b.Players != 1 {
		t.Errorf("week direction = %+v", b)
	}
	b := all.Boards[0]
	if b.PnL != fixed.FromInt(103) || b.Players != 2 || b.Trades != 2 {
		t.Errorf("all-time direction = %+v", b)
	}
	if len(b.Top) != 2 || b.Top[0].Wallet != "0xaaa" || b.Top[1].Wallet != "0xbbb" {
		t.Errorf("all-time top = %+v", b.Top)
	}
}

func TestWeekStartsMondayUTC(t *testing.T) {
	cases := map[time.Time]time.Time{
		time.Date(2026, 9, 7, 0, 0, 0, 0, time.UTC):   time.Date(2026, 9, 7, 0, 0, 0, 0, time.UTC),  // Monday
		time.Date(2026, 9, 13, 23, 0, 0, 0, time.UTC): time.Date(2026, 9, 7, 0, 0, 0, 0, time.UTC),  // Sunday
		time.Date(2026, 9, 14, 1, 0, 0, 0, time.UTC):  time.Date(2026, 9, 14, 0, 0, 0, 0, time.UTC), // next Monday
	}
	for in, want := range cases {
		if got := weekStartOf(in); !got.Equal(want) {
			t.Errorf("weekStartOf(%v) = %v, want %v", in, got, want)
		}
	}
}

// History is read a page at a time, newest first, and a page says where the
// next one starts. Memory has no pages — it holds one screen's worth at
// most — so this is about the shape the screens rely on.
func TestTradesPageAndTradeByIDWithoutAJournal(t *testing.T) {
	l := NewLedger()
	now := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)
	l.now = func() time.Time { return now }
	opened(l, "0xaaa", "direction", "MON")
	closed(l, "0xaaa", "direction", "MON", 2)

	rows, next, err := l.TradesPage(context.Background(), "0xaaa", "MON", "direction", 10, store.TradeCursor{})
	if err != nil || len(rows) != 1 || !next.IsZero() {
		t.Fatalf("page = %d rows, next %+v, err %v", len(rows), next, err)
	}
	// A second page of a memory ledger is empty rather than the first one
	// again: repeating a page is worse than ending early.
	rows, _, err = l.TradesPage(context.Background(), "0xaaa", "MON", "direction", 10, store.TradeCursor{ID: 7, OpenedAt: now})
	if err != nil || len(rows) != 0 {
		t.Fatalf("second page = %d rows, err %v", len(rows), err)
	}
	// And ids belong to the journal: without one there is nothing to open.
	if _, found, err := l.Trade(context.Background(), "0xaaa", 1); found || err != nil {
		t.Fatalf("trade by id without a journal: found %v, err %v", found, err)
	}
}

// The combined board counts a wallet once, however many strategies it
// played, and pages through the standings in result order.
func TestStandingsPageCountsWalletsOnce(t *testing.T) {
	l := NewLedger()
	now := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC) // a Thursday
	l.now = func() time.Time { return now }
	opened(l, "0xaaa", "direction", "MON")
	closed(l, "0xaaa", "direction", "MON", 5)
	opened(l, "0xaaa", "ma-cross", "MON")
	closed(l, "0xaaa", "ma-cross", "MON", 2)
	opened(l, "0xbbb", "direction", "MON")
	closed(l, "0xbbb", "direction", "MON", 3)

	rows, players, err := l.StandingsPage("week", "", 10, 0)
	if err != nil || players != 2 {
		t.Fatalf("players = %d, err %v", players, err)
	}
	if len(rows) != 2 || rows[0].Wallet != "0xaaa" || rows[0].PnL != fixed.FromInt(7) || rows[0].Trades != 2 {
		t.Fatalf("standings = %+v", rows)
	}
	// One board of its own, and a page past the end.
	rows, players, _ = l.StandingsPage("week", "ma-cross", 10, 0)
	if players != 1 || len(rows) != 1 || rows[0].PnL != fixed.FromInt(2) {
		t.Fatalf("ma-cross standings = %+v (%d players)", rows, players)
	}
	if rows, _, _ := l.StandingsPage("week", "", 10, 5); len(rows) != 0 {
		t.Fatalf("page past the end = %+v", rows)
	}
}
