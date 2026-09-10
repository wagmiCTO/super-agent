# ADR 0005 — One passkey, many keys

Date: 2026-09-11. Status: accepted.

## Context

The account layer is a passkey. Its PRF output is the only secret; everything
else is derived from it on the device (ADR 0003 describes the strategy
engine that spends what those keys authorise). Until now one thing was
derived — the wallet, a secp256k1 account at the standard BIP-44 path — and
the platform generated the exchange API key itself, one per wallet, and
identified the wallet by an unauthenticated header.

Two problems. First, one key for everything means one blast radius: revoking
the key stops every strategy, and every strategy trades under the same
limits. Second, a header is routing, not authentication, so the platform had
to trust its network boundary rather than the request.

The venue allows up to sixteen API keys per profile, each with its own label
and its own builder-fee ceiling, and forbids withdrawals for any API key.

## Decision

The passkey derives a family of keys, each with one job:

| Key | Curve | Derivation | Holder | Job |
|---|---|---|---|---|
| wallet | secp256k1 | BIP-39 phrase from the PRF output, path `m/44'/60'/0'/0/0` | device only | owns the exchange account, signs enrollments and the on-chain activation |
| request key | Ed25519 | `HMAC-SHA512(seed, "tradeagent/auth-key/v1")[:32]` | device only | signs every request to the platform |
| strategy key *i* | Ed25519 | `HMAC-SHA512(seed, "tradeagent/strategy-key/v1" ‖ i)[:32]` | device and platform | the exchange API key for strategy *i* |

Each strategy has a fixed key index in the catalog. Enabling a strategy
enrolls its key at the venue with a label naming the strategy and the
platform's builder terms; the wallet signs that document on the device. The
platform receives the strategy key as part of the enrollment, stores it
sealed (AES-256-GCM under a key from the environment), and trades with it —
it has to hold the key, because the exit is the engine's, not the user's
(ADR 0003). The platform never receives the wallet or the request key.

Limits are per strategy key: the policy engine's account is
`<wallet>/<strategy>`, with the strategy's own notional cap from the catalog.
Revoking one key at the venue stops one strategy. Rotating the whole family
is a new key index, and the same passkey on a new phone derives the same
keys, so nothing is lost with a device.

The request key is registered once with a wallet signature over a message
naming the key, and after that every request carrying `X-Account-Address`
also carries `X-Auth-Key`, `X-Auth-Time` and `X-Auth-Signature` over the
method, path, time and body hash. A wallet with a registered request key is
refused unsigned requests; a wallet without one is still served, so the
pre-passkey path and the browser tests keep working.

## Consequences

- The API key is delegated, as any exchange API key handed to a bot is; the
  difference is where it comes from. Its origin is the passkey, it cannot
  withdraw, and the user can reproduce or replace it without the platform.
- Strategy keys share one exchange account, so they share its positions: a
  Direction long and an RSI short on the same market net out at the venue.
  Isolating positions per strategy would need sub-accounts, which the venue
  does not offer; the policy engine's per-strategy limits are the boundary.
- Keys enrolled before this decision carry an empty strategy and serve
  every strategy under the wallet-wide account, until the user enables a
  strategy and its own key takes over.
- Sealing needs `PLATFORM_KEY_ENCRYPTION_KEY` in production. Without it the
  platform stores keys in the clear and says so at startup; rows written in
  the clear are re-sealed on the first start with a key.
