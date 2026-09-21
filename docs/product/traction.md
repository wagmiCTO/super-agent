# Traction

*Last true: 2026-09-22. Rows that carry a number were read that day; a row
that is still blank names where its number comes from, so filling it is a
query and not a judgement call.*

Everything here is **testnet**. The trades are real trades — signed, routed,
filled and settled on Perpl — but the money is play money. A number on this
page says something about whether people use the product, and nothing about
whether they made a living from it.

## Usage

| Measure | Value | Source |
|---|---|---|
| Wallets that opened at least one position | 14 | platform trade journal |
| Closed trades | 145 | platform trade journal |
| Volume, AUSD | 10,945.82 | platform trade journal |
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
| Direction | 114 | 14 | 9,472.34 | −42.74 | platform trade journal |
| MA Cross | 20 | 7 | 962.47 | +3.33 | platform trade journal |
| RSI Bounce | 11 | 3 | 511.01 | +2.76 | platform trade journal |

Traders are net down on Direction and slightly up on the two signal
strategies. On 145 trades that is not evidence of either; it is here because
leaving it out would make the page a sales sheet.

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
