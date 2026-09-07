package venue

import (
	"testing"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
)

// Rates measured against the live Perpl API on 2026-09-08 and the published
// Hyperliquid schedule. These two schedules are the reason FeeBasis exists.
var perplBase = FeeSchedule{
	MakerRate: fixed.Micros(90),  // 0.9 bps
	TakerRate: fixed.Micros(690), // 6.9 bps
	ChargedOn: FeeOnOpen,
}

var hyperliquidBase = FeeSchedule{
	MakerRate: fixed.MustParse("0.00015"), // 1.5 bps
	TakerRate: fixed.MustParse("0.00045"), // 4.5 bps
	ChargedOn: FeeOnEveryFill,
}

func TestRoundTripRate(t *testing.T) {
	tests := []struct {
		name                  string
		sched                 FeeSchedule
		entryMaker, exitMaker bool
		want                  string // as a fraction of notional
	}{
		{
			name:  "perpl taker in, taker out: charged once",
			sched: perplBase,
			want:  "0.00069",
		},
		{
			name:       "perpl maker in, taker out: only the entry is charged",
			sched:      perplBase,
			entryMaker: true,
			want:       "0.00009",
		},
		{
			name:      "perpl taker in, maker out: exit is free either way",
			sched:     perplBase,
			exitMaker: true,
			want:      "0.00069",
		},
		{
			name:  "hyperliquid taker both legs: charged twice",
			sched: hyperliquidBase,
			want:  "0.0009",
		},
		{
			name:       "hyperliquid maker in, taker out",
			sched:      hyperliquidBase,
			entryMaker: true,
			want:       "0.0006",
		},
		{
			name: "builder fee rides on the same basis",
			sched: FeeSchedule{
				MakerRate:   fixed.Micros(90),
				TakerRate:   fixed.Micros(690),
				BuilderRate: fixed.Bps(10),
				ChargedOn:   FeeOnOpen,
			},
			want: "0.00169",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := tc.sched.RoundTripRate(tc.entryMaker, tc.exitMaker)
			if want := fixed.MustParse(tc.want); got != want {
				t.Errorf("RoundTripRate = %s (%s bps), want %s", got, got.InBps(), want)
			}
		})
	}
}

// The whole product rests on this comparison: charging once at a higher rate
// still beats charging twice at a lower one, but only by about a third — not by
// the factor of two an equal-rate assumption would suggest.
func TestPerplBeatsHyperliquidRoundTripByLessThanHalf(t *testing.T) {
	perpl := perplBase.RoundTripRate(false, false)
	hyper := hyperliquidBase.RoundTripRate(false, false)
	if perpl.Cmp(hyper) >= 0 {
		t.Fatalf("expected perpl round trip %s to be cheaper than hyperliquid %s", perpl, hyper)
	}
	ratio := hyper.Div(perpl)
	if ratio.Cmp(fixed.MustParse("1.2")) < 0 || ratio.Cmp(fixed.MustParse("1.5")) > 0 {
		t.Errorf("hyperliquid/perpl round-trip ratio = %s, expected ~1.3", ratio)
	}
}

func TestRoundTripCostIncludesPostingFee(t *testing.T) {
	sched := perplBase
	sched.PostingFee = fixed.MustParse("0.1") // testnet recycle_fee, 0.1 AUSD

	notional := fixed.FromInt(1000)

	tests := []struct {
		name       string
		entryMaker bool
		posts      int
		want       string
	}{
		{"taker round trip posts nothing", false, 0, "0.69"},
		{"maker entry posts once", true, 1, "0.19"},
		{"maker both legs posts twice", true, 2, "0.29"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := sched.RoundTripCost(notional, tc.entryMaker, true, tc.posts)
			if want := fixed.MustParse(tc.want); got != want {
				t.Errorf("RoundTripCost = %s, want %s", got, want)
			}
		})
	}
}

// Leverage cancels out of the break-even move. This is the law from
// docs/fee-model.md, pinned so a future refactor cannot quietly reintroduce
// leverage into the calculation.
func TestBreakEvenMoveIsLeverageIndependent(t *testing.T) {
	sched := perplBase
	move := sched.BreakEvenMove(false, false)

	for _, lev := range []int64{1, 10, 15, 50} {
		leverage := fixed.FromInt(lev)
		stake := fixed.FromInt(100)
		notional := stake.Mul(leverage)

		fee := sched.RoundTripCost(notional, false, false, 0)
		pnl := notional.Mul(move)
		if fee != pnl {
			t.Errorf("at %dx: fee %s != break-even pnl %s", lev, fee, pnl)
		}
	}
}
