# Traction

*Last true: 2026-09-21. Nothing below is filled in yet; each row names where
its number comes from, so filling it is a query and not a judgement call.*

Everything here is **testnet**. The trades are real trades — signed, routed,
filled and settled on Perpl — but the money is play money. A number on this
page says something about whether people use the product, and nothing about
whether they made a living from it.

## Usage

| Measure | Value | Source |
|---|---|---|
| Wallets that opened at least one position | — | platform trade journal |
| Closed trades | — | platform trade journal |
| Volume, AUSD | — | platform trade journal |
| Wallets with ≥3 closed trades in a week | — | platform trade journal, grouped by week |
| Returned the next day / the next week | — | platform trade journal, first-seen vs later |

## How positions ended

The split that says whether the discipline defaults are doing anything, or
whether people turn them off and trade the way they always did.

| Ended by | Share | Source |
|---|---|---|
| Stop | — | platform trade journal |
| Target | — | platform trade journal |
| Horizon timer | — | platform trade journal |
| Closed by hand | — | platform trade journal |

## Result by strategy

| Strategy | Trades | Net result | Source |
|---|---|---|---|
| Direction | — | — | platform trade journal |
| MA Cross | — | — | platform trade journal |
| RSI Bounce | — | — | platform trade journal |

## Prize pools

Weekly pools are funded from fees actually received and settled from the
trade journal; winners claim from the contract themselves. The mechanism is
[`../adr/0006-prize-funding-from-received-fees.md`](../adr/0006-prize-funding-from-received-fees.md).

| Measure | Value | Source |
|---|---|---|
| Weeks settled | — | settlement receipts |
| Paid out, AUSD | — | `StrategyPrizePool` on Monad testnet |
| Contract address | — | deployment record |
| Indexer | — | Envio |

Anything in this section is checkable by a stranger without asking us, which
is the point of settling it on chain.

## Reading this page

A blank is a blank, not a zero. When a row is filled, it is filled from a
query against the journal on a stated date, and the date at the top moves.
