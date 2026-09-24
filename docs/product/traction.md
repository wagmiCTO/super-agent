# Traction

*Last true: 2026-09-25. Rows that carry a number were read that day; a row
that is still blank names where its number comes from, so filling it is a
query and not a judgement call.*

Everything here is **testnet**. The trades are real trades — signed, routed,
filled and settled on Perpl — but the money is play money. A number on this
page says something about whether people use the product, and nothing about
whether they made a living from it.

## Usage

| Measure | Value | Source |
|---|---|---|
| Wallets that opened at least one position | 15 | platform trade journal |
| Closed trades | 181 | platform trade journal |
| Volume, AUSD | 16,457.27 | platform trade journal |
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

| Strategy | Trades | Wallets | Volume, AUSD | Net result, AUSD | Source |
|---|---|---|---|---|---|
| Direction | 128 | 15 | 10,900.21 | −45.79 | platform trade journal |
| MA Cross | 35 | 8 | 3,630.27 | −0.25 | platform trade journal |
| RSI Bounce | 18 | 4 | 1,926.78 | −0.55 | platform trade journal |

Traders are net down on Direction and roughly flat on the two signal
strategies. On 181 trades that is not evidence of either; it is here because
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
| Indexer | https://indexer.dev.hyperindex.xyz/45c9bd0/v1/graphql | Envio |

Anything in this section is checkable by a stranger without asking us, which
is the point of settling it on chain.

## Reading this page

A blank is a blank, not a zero. When a row is filled, it is filled from a
query against the journal on a stated date, and the date at the top moves.
