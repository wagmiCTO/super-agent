# ADR 0006 — The prize pool is funded from fees the platform has received

Status: accepted · 2026-09-17

## Context

ADR 0004 put the weekly prize on-chain: every closed round trip funds its
strategy's pool, the week is settled from the journal, winners claim. The
funding was a flat amount per trade, sent from the settler wallet's own
AUSD as trades closed. It had nothing to do with what the platform earned:
the platform's income is the builder fee the venue charges on every fill
credited to our builder code (0.05% of notional, on top of the venue's own
taker fee), and that fee accrues on the venue, not in the settler wallet.
Two things followed. The pool grew faster than the income — a week of
losing trades still filled it — and it was paid out of a balance nobody
was topping up, so the settler wallet was quietly subsidising the game.

The second half of the problem was carry: a week with no winner carried its
whole pool forward, and the next week again, so a pool could grow for
weeks out of nothing. The contract now carries money once (see
`StrategyPrizePool.carriedIn` / `retained`).

## Decision

The pool is fed with money the platform has actually received, after the
week is over, and never more than that.

1. **The platform counts what each week earned.** The builder fee of every
   fill is journaled with the trade (`entry_builder_fee`,
   `exit_builder_fee`). A strategy's *accrued* pool for a week is
   `PLATFORM_PRIZE_FEE_SHARE` percent (50 by default) of the builder fees
   its round trips paid that week. It is shown in the app during the week
   as the pool "so far" — a number, not money on the contract.
2. **Nothing goes on-chain until the fees have arrived.** Once a week is
   over, an operator withdraws the week's builder fees from the venue to
   the settler wallet and confirms the receipt to the platform:
   `POST /v1/admin/prizes/receipts {week, amount}`, authenticated with
   `PLATFORM_ADMIN_TOKEN`. One receipt per week; a second is refused.
3. **Funding is capped by the receipt.** Each strategy's pool for that week
   is funded with its accrued share, scaled down proportionally if less
   was received than was accrued (`min(accrued, received × share)`), so
   the contract never holds more than the platform was paid.
4. **Settlement follows the funding.** The same call settles the week for
   every strategy whose pool has money: winners are published and can
   claim from that moment. The weekly settlement loop stays as a safety
   net for a pool that was funded but whose settlement transaction failed.
5. **Weekly, not fortnightly.** The board, the contract and the claim are
   weekly; a fortnightly receipt would only delay the claim. Fees may be
   withdrawn from the venue less often, but each week is confirmed and
   settled on its own.

The venue's side of the withdrawal is not automated: it is not yet known
whether builder fees are credited to the platform's own venue account
(withdrawable through the venue's API) or to a separate builder ledger.
Until that is settled, the withdrawal is a manual step and the receipt is
the platform's only trigger — which is the safe default either way.

## Consequences

- The lobby and the leaderboard show "Pool X AUSD so far" during the week
  and the funded pool once the receipt is in. Winners of week W claim on
  Monday of W+1 after the receipt, not at midnight.
- The settler wallet needs gas (MON) for the funding and settlement
  transactions and AUSD only as far as the receipt says; it no longer pays
  out of its own pocket.
- An unconfirmed week is never settled: its pool stays at zero on-chain and
  nobody can claim. Confirming a receipt is the operator's weekly duty.
- `PLATFORM_PRIZE_PER_TRADE` is gone. The ledger's close hook no longer
  funds anything.
