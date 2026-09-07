# ADR-0001: Venue adapter interface

- Status: accepted
- Date: 2026-09-08
- Context: the strategy engine and its five pluggable parts

## Context

The strategy engine must run against Perpl (Monad, hackathon) and Hyperliquid
(the actual product) without being rewritten. The venue adapter is the seam.
Everything above it — signal sources, position rules, leaderboard metrics — must
never mention a venue.

Getting the seam wrong is the single most expensive mistake available to us: the
whole point of the hackathon is that the engine survives the port. So the
interface is fixed before the first strategy is written.

The two venues differ in ways that leak upward if the interface ignores them.
Measured against the live Perpl API on 2026-09-08 and the Hyperliquid docs:

| | Perpl | Hyperliquid |
|---|---|---|
| Fee charged on | opening/increasing size only | every fill |
| Base taker / maker | 6.9 bps / 0.9 bps | 4.5 bps / 1.5 bps |
| Fee tiers | index into per-market arrays, from 14d volume | per-account, from 14d volume |
| Order lifetime | `order_ttl_blocks` = 20 blocks ≈ 6 s | no equivalent |
| Order identity | `rq`, strictly increasing per account | client order id, arbitrary |
| Max leverage | per market, 3x–15x | per market, up to 40x |
| Posting a maker order | `recycle_fee` (0 on mainnet, 0.1 AUSD on testnet) | free |
| Collateral | AUSD | USDC |
| Transport | REST + two WebSockets | REST + WebSocket |

## Decision

### 1. The adapter is an interface in `internal/venue`, implementations live in subpackages

`internal/venue` declares `Adapter` and the value types. `internal/venue/perpl`
implements it. Nothing in `internal/venue` imports an implementation.

### 2. The fee model is part of the interface, not of the implementation

Fee structure is not an implementation detail here — it is the product. The whole
strategy lobby exists because a round trip costs what it costs, and the number
differs by venue in *shape*, not just in rate. So `FeeSchedule` carries a
`ChargedOn` discriminator (`FeeOnOpen` vs `FeeOnEveryFill`) and the engine asks
the venue for `RoundTripCost`, never multiplying a rate by two itself.

A strategy that picks its parameters from `RoundTripCost` ports. A strategy with
`0.29%` written into it does not.

### 3. Prices and sizes are fixed-point, never floats

`internal/fixed.D` is an `int64` scaled by 1e8. Venue-specific scaling
(Perpl's per-market `price_decimals` / `size_decimals`) is converted at the
adapter boundary and never escapes it. No float64 touches money.

### 4. The adapter exposes constraints; it does not silently correct them

`Market` carries `MaxLeverage`, `PriceTick`, `SizeStep`, `MinNotional`,
`OrderTTL`. The adapter rejects an order that violates them rather than clamping
it, because a clamped order makes our accounting disagree with the exchange.
The one exception is rounding to `PriceTick`/`SizeStep`, which is arithmetic, not
a policy decision, and is done in the adapter.

`OrderTTL` is exposed as a duration rather than a block count: the engine may
need to know that an order which is not filled within ~6 seconds is gone, but it
must not learn what a Monad block is. Hyperliquid returns zero, meaning "no
limit".

### 5. Idempotency is the adapter's problem

The engine supplies a `ClientID string` on every order. Perpl's `rq` is a
strictly increasing `uint64` seeded from `Account.lfr`; Hyperliquid's `cloid` is
a 128-bit value. The adapter maps between them and keeps the mapping. The engine
must be able to retry `Place` with the same `ClientID` and get at-most-once
execution — that is the contract, regardless of how the venue spells it.

### 6. Streams are channels closed on context cancellation

Every streaming method takes a `context.Context` and returns a receive-only
channel plus an error. Reconnection, re-subscription and snapshot recovery are
the adapter's job; the engine sees an uninterrupted stream. A sequence gap that
the adapter cannot repair closes the channel — the engine treats a closed stream
as loss of state and re-reads positions, it does not assume the venue is idle.

### 7. Read paths are separate from the trading path

`Markets`, `Candles`, `StreamCandles`, `StreamBook` need no credentials.
Constructing an adapter without an API key yields a working market-data client
whose trading methods return `ErrNoCredentials`. This keeps market-data
development unblocked while exchange accounts are being provisioned, and it
means the backtest/simulation path never holds keys.

## Consequences

- A second strategy costs no venue work. That is the acceptance test for this interface.
- The Hyperliquid adapter is a package, not a refactor.
- The engine cannot express a venue-specific order type. Perpl's trigger orders
  (`tp`/`tpc`) and linked triggers (`tr`/`lp`) are attractive for stop-loss but
  have no Hyperliquid-shaped equivalent in the same form, so v1 keeps SL/TP in
  the policy engine, server-side, and revisits this once both adapters exist.
- `FeeSchedule` says nothing about funding. Funding is a holding cost, not an
  action cost; it belongs to position accounting and is added when strategies
  hold overnight, which none of the first three do.

## Alternatives rejected

**A thin "send this JSON" transport with venue logic in the engine.** Cheaper
today, and it makes the engine venue-aware — which is the exact failure the
hackathon is meant to prevent.

**Copying an existing SDK's interface.** Perpl's SDK models Perpl; adopting its
shape imports `order_ttl_blocks` and scaled integers into the engine.

**Deferring the fee model to the strategies.** Each strategy would re-derive the
round-trip cost, and each would get it wrong in a different way when ported.
