# Traction

*Last true: 2026-09-28. Rows that carry a number were read that day; a row
that is still blank names where its number comes from, so filling it is a
query and not a judgement call.*

Everything here is **testnet**. The trades are real trades — signed, routed,
filled and settled on Perpl — but the money is play money. A number on this
page says something about whether people use the product, and nothing about
whether they made a living from it.

The journal also holds 28 rows written by hand on 16 September to give the
demo screens a history: twelve on one wallet and two wallets that exist only
there. They were never orders at the venue. Every number on this page leaves
them out.

## Usage

| Measure | Value | Source |
|---|---|---|
| Wallets that opened at least one position | 14 | platform trade journal |
| Closed trades | 161 | platform trade journal |
| Volume, AUSD | 15,900.34 | platform trade journal |
| Wallets with ≥3 closed trades in a week | — | platform trade journal, grouped by week |
| Returned the next day / the next week | — | platform trade journal, first-seen vs later |

## How positions ended

The split that says whether the discipline defaults are doing anything, or
whether people turn them off and trade the way they always did.

| Ended by | Share | Source |
|---|---|---|
| Stop | 6% (10) | platform trade journal |
| Target | 0% | platform trade journal |
| Horizon timer | 56% (90) | platform trade journal |
| Closed by hand | 36% (58) | platform trade journal |
| Not recorded | 2% (3) | platform trade journal |

## Result by strategy

| Strategy | Trades | Wallets | Volume, AUSD | Net result, AUSD | Source |
|---|---|---|---|---|---|
| Direction | 113 | 13 | 10,318.22 | −49.74 | platform trade journal |
| MA Cross | 31 | 8 | 3,458.27 | −5.14 | platform trade journal |
| RSI Bounce | 15 | 4 | 1,741.74 | −2.29 | platform trade journal |
| Turtles | 2 | 1 | 382.11 | −3.22 | platform trade journal |
| Open Range | 0 | 0 | 0 | 0 | platform trade journal |

Traders are net down on every strategy, most of it on Direction. On 161
trades that is not evidence of either; it is here because
leaving it out would make the page a sales sheet.

## Prize pools

Weekly pools are funded from fees actually received and settled from the
trade journal; winners claim from the contract themselves. The mechanism is
[`../adr/0006-prize-funding-from-received-fees.md`](../adr/0006-prize-funding-from-received-fees.md).

| Measure | Value | Source |
|---|---|---|
| Weeks settled | 1 (week of 14 Sep) | settlement receipts |
| Funded and settled, AUSD | 1.398321, four winners able to claim | `StrategyPrizePool` on Monad testnet |
| Contract address | `0x1cC7f88b21E0158e70323aad98Dea4dC20b380aC` | deployment record |
| Indexer | https://indexer.dev.hyperindex.xyz/d848917/v1/graphql | Envio |

Anything in this section is checkable by a stranger without asking us, which
is the point of settling it on chain.

## Reading this page

A blank is a blank, not a zero. When a row is filled, it is filled from a
query against the journal on a stated date, and the date at the top moves.
