# The fee model, and why it decides the product

Every design choice above the venue adapter is downstream of one inequality.
This document states it once, so code and decision records can cite it instead
of re-deriving it.

## The law

A position that is opened and closed pays a **round trip**. Whether the venue
charges once or twice, and at what rate, is the whole of it:

```
round trip = entry fee + exit fee        (fee charged on every fill)
round trip = entry fee                   (fee charged only on opening size)
```

Both shapes exist in production. Hyperliquid charges every fill: 4.5 bps taker,
1.5 bps maker, so a taker round trip is 9 bps. Perpl charges only the size that
opens or increases a position: 6.9 bps taker, 0.9 bps maker, so a taker round
trip is 6.9 bps and the exit is free either way.

The consequence is that a strategy's parameters cannot be written against a
rate. They must be written against `FeeSchedule.RoundTripRate`, which knows the
shape. A number like "0.29% per round trip" baked into a strategy is correct for
exactly one venue at exactly one builder-fee setting.

## Expected move against cost

For a driftless random walk with per-minute volatility σ, the mean absolute move
over `t` minutes is:

```
E|move| = σ · √t · √(2/π)   ≈ 0.8 · σ · √t
```

Setting that equal to the round-trip cost gives the **break-even holding time**:
the horizon at which the expected move just covers the fee. Below it, a mechanic
is losing money on average no matter how it is presented.

`services/cmd/breakeven` computes this per market from live fee schedules and
real candles. The current measurement is in `perpl-economics.md`.

## Leverage does not help

The tempting move — raise leverage until a one-minute round trip feels dramatic
— does not change the arithmetic.

With stake `S` and leverage `L`, notional is `S·L`:

- fee `= rate · S · L`, which as a fraction of stake is `rate · L`
- pnl `= S · L · move`, which as a fraction of stake is `L · move`

Leverage multiplies both sides and cancels. **The move required to break even is
the round-trip rate, at any leverage.** Leverage changes the amplitude of the
experience, not the ratio of signal to cost.

A worked example: stake $50 at 50x is $2,500 notional. At 6.9 bps the round trip
costs $1.73 while the expected one-minute move on a 30%-vol asset is worth
about $0.96. The player pays $1.73 to play for $0.96. At 10x it is $0.35 against
$0.19 — the same 1.8x ratio.

`FeeSchedule.BreakEvenMove` returns this, and a test pins the invariant so a
refactor cannot quietly reintroduce leverage into the calculation.

## Three levers, and only three

Since leverage is out, a mechanic that clears its fee must use at least one of:

1. **Holding time.** Longer holds earn more move against the same fee.
2. **Asset volatility.** A high-vol asset delivers in seconds what BTC delivers
   in minutes.
3. **The fee rate itself.** Halving the builder fee halves the threshold.

A mechanic with none of the three is dead on arrival, however well it is built.

## Cost is paid by actions, not by time

Holding is free — funding is separate and small at these horizons. Only opening
and closing cost anything. So a design that produces **many decisions and few
trades** is economically healthy, and one where every interaction is a round trip
is not. This inverts the naive reading: more micro-bets is not more volume, it is
a faster path to an exhausted balance.

## What this means for the venue adapter

`internal/venue` therefore treats the fee model as part of the interface rather
than an implementation detail:

- `FeeBasis` distinguishes the two shapes.
- `RoundTripRate(entryMaker, exitMaker)` is the only sanctioned way to ask what a
  round trip costs.
- `PostingFee` carries per-order charges, which are flat and therefore hit small
  positions hardest — on a $50 position, a 0.1 unit posting fee is 20 bps,
  three times the taker rate.

See `adr/0001-venue-adapter-interface.md`.
