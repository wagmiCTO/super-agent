# super-agent

Two coupled products around perpetual futures trading:

1. **A trading app** where trading is broken into simple strategy games with
   leaderboards, executing real perps on-chain.
2. **A signer** — a signing and custody layer with a policy engine, so an agent
   or an app never holds a raw private key.

Technical decisions live in `docs/adr/`. The economics that drive the design are
in `docs/fee-model.md`, measured in `docs/perpl-economics.md`.

## Layout

| Directory | What lives here |
|---|---|
| `apps/mobile` | The mobile app — the product surface |
| `services` | Go module: every backend binary and the packages they share |
| `contracts` | Solidity: on-chain leaderboard and policy engine |
| `api` | The app ↔ services contract, language-neutral |
| `docs` | Technical documentation and architecture decision records |
| `design` | Visual prototypes and design canvases |

See `docs/adr/0002-repository-layout.md` for why it is arranged this way.

## Backend

```bash
cd services
go test ./...

# Inspect the Perpl venue: markets, real fee schedules, candles, live data.
go run ./cmd/perplcheck -stream

# Recompute the fee threshold every strategy's parameters derive from.
go run ./cmd/breakeven
```

Everything defaults to **testnet**. Mainnet requires `PERPL_ALLOW_MAINNET=1`
alongside `PERPL_NETWORK=mainnet`, and the adapter logs a warning when it is on.

### Trading against Perpl

Market data needs no credentials. Placing an order needs three separate things,
and missing any one of them fails differently:

1. An enrolled **API key** — create one at
   [testnet.perpl.xyz/apikeys](https://testnet.perpl.xyz/apikeys) with the
   `trade` scope, then export `PERPL_API_KEY` and `PERPL_API_KEY_SECRET`.
2. An **exchange account** — `createAccount()` on the Exchange contract, funded
   with the minimum collateral the API reports (100 AUSD on testnet).
3. **Order forwarding** — `allowOrderForwarding(true)` from the account's own
   wallet. Without it orders are acknowledged and then fail with reason 34.

```bash
cd services
go run ./cmd/perplcheck          # read-only: markets, candles, account
go run ./cmd/perplcheck -trade   # opens a position and closes it again
```
