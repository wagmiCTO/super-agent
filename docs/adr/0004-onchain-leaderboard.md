# ADR 0004: The leaderboard is a contract, settled one trade at a time

**Status:** accepted, 2026-09-10

## Context

Every strategy has a weekly board: what it made for all its players, who is
up, how many trades. Until now that board lived in the platform's memory
(ADR 0003's ledger). A board in our database asks the user to trust us twice —
that the numbers are real, and that we did not edit them. A board that is a
contract asks for neither: the venue's fills are public, the records are
public, and anyone can recompute the week.

This is also the honest answer to "why does this need Monad". A leaderboard
settled per trade is thousands of small writes a minute at peak — cheap and
fast here, unaffordable on Ethereum. Nothing else in the product needs a
particular chain: the venue adapter and the account layer are chain-agnostic
by design.

## Decision

`contracts/src/StrategyLeaderboard.sol`:

- **One write per closed round trip.** `recordTrade(strategy, wallet, pnl,
  closedAt, ref)`; the contract aggregates by ISO week (Monday 00:00 UTC),
  per wallet and per strategy, and emits `TradeRecorded`. `pnl` is the
  realized result in collateral micros, fees included — the same number the
  platform's daily-loss limit sees. There is no off-chain summary pushed at
  the end of the week.
- **`ref` is the audit trail.** It is the hash of the venue order ids of the
  round trip. It makes every record idempotent (a retry cannot double count)
  and lets anyone tie a record back to the exchange.
- **Writers are settlers; the owner appoints them.** The platform holds a
  settler key. A settler can only add records; it cannot edit or delete one,
  and a record needs a unique `ref`. Misbehaviour is visible, not silent.
- **Reads are `eth_call`s.** `totalOf(week, strategy)` and `scoreOf(week,
  strategy, wallet)` are what the app's lobby shows. Ranking across wallets
  needs enumeration the contract does not do; that is the indexer's job
  (Envio over `TradeRecorded`), and until it exists the platform ranks the
  wallets it knows.

The platform side (`services/internal/chain`) speaks JSON-RPC and signs
EIP-1559 transactions itself, with `decred/secp256k1` for the curve — the
same "own the wire protocol" rule as the venue adapter, and one small
dependency rather than a client framework. Settlement runs off the trade
path: a closed trade is queued and sent with retries; a failed settlement
never blocks a close.

## Consequences

- The gate of sprint 3 — the board is read from the contract, not our
  database — is met once `/v1/leaderboard` reads totals and scores via
  `eth_call` and the in-memory ledger is only the fallback while the chain
  is unreachable.
- Two keys now exist on the platform: the venue API keys of the users and the
  settler key. Both live in the same secret store; the settler key can spend
  gas and nothing else of value, but it is still a key.
- Records are public. Wallet addresses on a board are public by
  construction; there is no account name to leak. A later privacy option
  would be a per-user pseudonymous wallet, not a change to the contract.
- Testnet first; a mainnet deployment is a deliberate step with its own
  settler key, and the contract address becomes configuration, never code.
