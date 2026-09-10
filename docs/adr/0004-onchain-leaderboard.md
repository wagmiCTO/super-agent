# ADR 0004: The weekly prize is a contract; the leaderboard is a table

**Status:** accepted, 2026-09-10 (supersedes the same day's first draft,
which put the leaderboard itself on-chain)

## Context

Every strategy has a weekly board — what it made for all its players, who is
up, how many trades — and the product wants a reason to come back next week:
a prize for the top of each board.

The first draft of this ADR settled every closed trade into a leaderboard
contract. It worked, and it was withdrawn the same day: a board that exists
on-chain only so that it can be said to exist on-chain reads as built for a
bounty, and for the platform's own bookkeeping a contract is a poor database
— it cannot enumerate, cannot be corrected, and charges gas to write.

What does need a chain is money that must not be ours to take back.

## Decision

**The system of record is Postgres** (`services/internal/store`): keys,
policy state, pending horizons, and a journal of round trips from which the
boards are computed. Every engine keeps working from memory and writes
through; a restart restores from the database.

**The prize is a contract** — `contracts/src/StrategyPrizePool.sol`, over
the venue's collateral token (AUSD):

- `fund(week, strategy, amount)`: anyone can add to a strategy's pool for a
  week. The platform does, out of its builder fees, a fixed amount per
  closed trade, so the pool grows in front of the players during the week.
- `settle(week, strategy, winners, amounts, pnls)`: once the week is over, a
  settler publishes who won and with what result. Amounts must fit in the
  pool; what is not allocated carries into the next week of the same
  strategy. Settling is final: no second settle, no funding a settled week.
- `claim(week, strategy)`: each winner takes their own prize. The platform
  never holds the payout and cannot redirect it.

The winners are computed off-chain from the journal — top three by realized
result, 50/30/20 of the pool, positive results only — and published together
with the results they earned it on, so anyone can check the list against the
venue's public fills. The platform's whole power over the money is to publish
that list, once, in public.

The platform talks to the chain through `services/internal/chain`: JSON-RPC
and locally signed EIP-1559 transactions, with `decred/secp256k1` for the
curve — the same "own the wire protocol" rule as the venue adapter.

## Consequences

- The lobby shows the live pool per strategy and last week's winners; a
  winner sees a claim button and signs the claim with the passkey wallet,
  the same way it signs its activation.
- The settler key spends gas and the prize budget, nothing else. On testnet
  it is funded by hand; on mainnet the budget is a share of builder fees.
- Weeks are ISO weeks, Monday 00:00 UTC, in both the contract and the
  journal; the week index is `(unix + 3 days) / 7 days`.
- Testnet first: `0x19952068Ce2D25C672d71cD48775A9f43438f4E6` over AUSD
  `0xa9012a…22dc`. A mainnet deployment is a deliberate step with its own
  settler, and the address stays configuration.
