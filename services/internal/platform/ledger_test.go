package platform

import (
	"testing"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
)

// The week's board per strategy: who is up, what the strategy made for
// everyone, who is in a position right now. Last week's trades do not count.
func TestLeaderboardByStrategyAndWeek(t *testing.T) {
	l := NewLedger()
	now := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC) // a Thursday
	l.now = func() time.Time { return now }

	// Last week: must not count.
	now = time.Date(2026, 9, 6, 12, 0, 0, 0, time.UTC)
	l.Opened("0xaaa", "direction", "MON", "o")
	l.Closed("0xaaa", "MON", fixed.FromInt(100), "c")

	now = time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	l.Opened("0xaaa", "direction", "MON", "o")
	l.Closed("0xaaa", "MON", fixed.FromInt(3), "c")
	l.Opened("0xbbb", "direction", "MON", "o")
	l.Closed("0xbbb", "MON", fixed.FromInt(-1), "c")
	l.Opened("0xbbb", "ma-cross", "MON", "o")
	l.Closed("0xbbb", "MON", fixed.FromInt(5), "c")
	// An untagged position from before a restart counts as Direction.
	l.Closed("0xccc", "MON", fixed.FromInt(1), "c")
	// Open right now under MA Cross.
	l.Opened("0xaaa", "ma-cross", "MON", "o")

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
	if s, ok := l.StrategyOf("0xaaa", "MON"); !ok || s != "ma-cross" {
		t.Errorf("StrategyOf = %q, %v", s, ok)
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
