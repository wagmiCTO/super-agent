package venue

import "github.com/wagmiCTO/super-agent/services/internal/fixed"

// FeeBasis says which fills a venue charges for. This is the difference that
// makes a strategy's parameters non-portable if the engine ignores it: Perpl
// charges once per round trip, Hyperliquid twice.
type FeeBasis uint8

const (
	// FeeOnEveryFill charges opening and closing fills alike (Hyperliquid).
	FeeOnEveryFill FeeBasis = iota
	// FeeOnOpen charges only the size that opens or increases a position (Perpl).
	FeeOnOpen
)

func (b FeeBasis) String() string {
	if b == FeeOnOpen {
		return "open-only"
	}
	return "every-fill"
}

// FeeSchedule is what a trade costs on this venue, at this account's tier.
// Rates are fractions of notional: 0.00069 is 6.9 bps.
type FeeSchedule struct {
	MakerRate fixed.D
	TakerRate fixed.D
	// BuilderRate is the fee our own integration adds, on the same basis as
	// the protocol fee. Zero until a builder code is issued.
	BuilderRate fixed.D
	ChargedOn   FeeBasis
	// PostingFee is charged per resting order posted, in collateral units,
	// regardless of whether it fills (Perpl's recycle_fee). Zero on venues
	// where posting is free.
	PostingFee fixed.D
}

// Rate is the fee fraction for one fill on the given liquidity side.
func (f FeeSchedule) Rate(maker bool) fixed.D {
	if maker {
		return f.MakerRate.Add(f.BuilderRate)
	}
	return f.TakerRate.Add(f.BuilderRate)
}

// RoundTripRate is the total fee fraction of notional for opening and then
// closing a position, given how each leg provides liquidity. It is the number
// every strategy's parameters are derived from — no caller multiplies a rate by
// two on its own, because on a FeeOnOpen venue that answer is wrong.
func (f FeeSchedule) RoundTripRate(entryMaker, exitMaker bool) fixed.D {
	if f.ChargedOn == FeeOnOpen {
		return f.Rate(entryMaker)
	}
	return f.Rate(entryMaker).Add(f.Rate(exitMaker))
}

// RoundTripCost is RoundTripRate applied to a notional, plus any posting fees
// the legs incur. posts is the number of resting orders the round trip posts —
// two for a maker-in/maker-out strategy, zero for a pure taker one.
func (f FeeSchedule) RoundTripCost(notional fixed.D, entryMaker, exitMaker bool, posts int) fixed.D {
	cost := notional.Mul(f.RoundTripRate(entryMaker, exitMaker))
	if posts > 0 && !f.PostingFee.IsZero() {
		cost = cost.Add(f.PostingFee.Mul(fixed.FromInt(int64(posts))))
	}
	return cost
}

// BreakEvenMove is the fraction the price must move in the position's favour to
// cover the round trip. Leverage does not appear: it multiplies notional and PnL
// alike and cancels out — see docs/fee-model.md.
func (f FeeSchedule) BreakEvenMove(entryMaker, exitMaker bool) fixed.D {
	return f.RoundTripRate(entryMaker, exitMaker)
}
