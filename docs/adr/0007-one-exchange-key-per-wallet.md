# ADR 0007 — One exchange key per wallet; the strategy is an attribute of the order

Status: accepted · 2026-09-17 · amends ADR 0005

## Context

ADR 0005 gave every strategy its own exchange API key, derived from the
passkey at the strategy's index and enrolled at the venue one strategy at
a time. The user met this as an "Enable" step per strategy: a strategy
screen without a key showed SIGN IN and dead keys until the account
screen had been visited.

Three things were expected of per-strategy keys, and none of them holds:

- **Limits per strategy.** The policy engine counts them by its own
  account name, which the request names in `X-Strategy` and the order in
  its body. Which API key signed the order is not part of it. The only
  per-strategy limit in the catalog is a notional cap, and the wallet's
  budget, cooldown and open-position count were already shared across
  strategies through the limits group.
- **Revoking one strategy at the venue.** The platform is the trust
  boundary and can refuse a strategy at once, with no round trip to the
  venue: the kill switch and the policy engine are where a strategy is
  stopped.
- **A smaller blast radius.** Every key is sealed on the same platform;
  a leak of the platform leaks them together. Positions were never
  isolated either: the keys share one exchange account, the venue has no
  sub-accounts, and a position per market nets across strategies whatever
  signs for it.

What per-strategy keys do cost is a ceiling: the venue allows sixteen API
keys per profile, so the design stops at the sixteenth strategy, and a
product that means to grow a catalog cannot start from there.

## Decision

A wallet enrolls **one** exchange API key, once, when the account is
opened. Every strategy trades through it. The strategy is what the order
says it is (`strategy` in the body, `X-Strategy` on reads), and that is
what the ledger records and the policy engine budgets by.

- **Derivation.** The key is the family's slot 0 — the slot Direction's
  key had — so a wallet from before this decision already holds it and
  nothing is re-enrolled. The domain and the index do not change.
- **Resolution.** The registry serves one venue connection and one
  service per wallet, under the policy account of the wallet's address.
  Any key the wallet has enrolled is that key: a wallet-wide one first,
  otherwise the strategy key it enrolled under ADR 0005.
- **Per-strategy limits.** The catalog's notional cap is checked when an
  order is opened, by the strategy the order names. Everything else is
  the wallet's, as it was.
- **Whose position it is.** The ledger remembers which strategy opened
  each position (journaled, so a restart does not forget), and the
  platform reports it on every position in `/v1/state`. A strategy screen
  shows its own; a market another strategy holds is offered greyed out.
- **The contract.** `X-Strategy` and the enrollment's `strategy` field
  stay in the API for older clients; neither selects a key any more.

## Consequences

- One enrollment per wallet: no "Enable" per strategy, no strategy screen
  that cannot trade, and a hundred strategies cost nothing more than
  three.
- Revoking the key at the venue stops every strategy of the wallet. That
  is what revoking a delegated key should mean; stopping one strategy is
  the platform's job.
- Horizons and stops journaled under `<wallet>/<strategy>` before this
  decision are restored under the wallet's account on the first
  connection after it, so a position that was open across the deploy
  still closes on time.
- The venue's key page shows one key labelled "TradeAgent"; older
  wallets keep the "TradeAgent · Direction" label on the same key.
