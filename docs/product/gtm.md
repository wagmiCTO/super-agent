# Go to market

*Last true: 2026-09-21. One page on purpose.*

## Who

The trader described in [`icp.md`](icp.md): already trading perps with
leverage, losing to discipline rather than to analysis.

## Where he already is

- **X.** The Perpl and Monad conversations, and the wider perps-trading
  timeline. This is where the segment talks about its own losses.
- **Monad and Perpl community channels.** People here already have a wallet
  and a reason to try something on this chain.
- **The referral already in the app.** An invited friend's fees pay their
  inviter a share, so a user who likes it has a reason to hand it on. This is
  the only channel that costs nothing per head.

No paid acquisition. At this stage a paid install teaches us nothing about
whether the product holds someone.

## The one metric

**Wallets with three or more closed trades in a week.**

Not installs, not sign-ups, not total volume. Three closed trades means the
person got through onboarding, took a position, saw it resolve, and chose to
come back — which is the whole hypothesis in one number. Everything else is
diagnostic.

## The funnel underneath it

| Step | What it measures |
|---|---|
| Opened the app | the post did its job |
| Created a passkey | the account is not the obstacle |
| First tap | the lesson did its job |
| Third closed trade **in the same week** | the product holds |
| Came back the next week | the weekly pool does its job |

## How we make money

The builder fee on every trade routed through the platform. It is charged on
open, it is a fraction of the round trip, and the arithmetic of what that
leaves the user is in [`../fee-model.md`](../fee-model.md). A share of fees
received funds the weekly prize pools — the mechanism and why it is funded
that way is [`../adr/0006-prize-funding-from-received-fees.md`](../adr/0006-prize-funding-from-received-fees.md).

We do not take a cut of profit and we do not promise the user a return.

## What comes next

1. **Now — testnet.** Real execution, real fills, play money. The point is to
   learn whether the product holds someone, without asking them to risk
   anything to find out.
2. **Then — mainnet on Perpl**, with deposits from any chain. The policy
   engine gets its own mainnet limits before a single real order is signed.
3. **Then — a second venue.** The venue sits behind an interface for exactly
   this reason ([`../adr/0001-venue-adapter-interface.md`](../adr/0001-venue-adapter-interface.md)),
   so a second one is an adapter rather than a rewrite.

## Ninety days

| Target | Value |
|---|---|
| Wallets with ≥3 closed trades in a week | not set |
| Weekly volume | not set |

*Both to be set from the first two weeks of real usage rather than guessed
now — a number invented before the test is a number nobody is accountable to.*
