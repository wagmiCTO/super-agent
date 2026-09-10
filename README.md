# TradeAgent

Mobile-first perps trading as strategy games, executed on-chain through
[Perpl](https://perpl.xyz) on Monad.

A player picks a strategy — Direction, MA Cross, RSI Bounce — and the
strategy frames one decision: an amount, a horizon, a tap. The platform
puts the order through a policy engine, places it at the venue, and owns
the exit: it closes the position when the horizon ends, whether the phone
is awake or not. Every closed round trip goes to a weekly leaderboard per
strategy and funds an on-chain prize pool that pays the top three.

- The account is a passkey. From its PRF output the device derives a
  wallet, a request-signing key and one exchange API key per strategy.
  The platform never holds the wallet ([ADR 0005](docs/adr/0005-one-passkey-many-keys.md)).
- Before an entry, a card shows what the crowd on-chain has been doing with
  the asset (Nansen). Collateral can arrive from any chain (Aurora Intents).
- The prize pools are a contract on Monad; an Envio indexer serves their
  history to the lobby.

Live: [inflight.work](https://inflight.work) (web build of the app, Monad
testnet, Perpl testnet). Technical decisions are in [`docs/adr/`](docs/adr).

## Layout

| Directory | What lives here |
|---|---|
| `apps/mobile` | Expo / React Native app — the product surface; web build served from Vercel |
| `services` | Go module: the platform (`cmd/platform`), the Perpl venue adapter, the policy engine, the strategy signals |
| `contracts` | Foundry: `StrategyPrizePool`, the weekly prize pool |
| `indexers/prize-pool` | Envio HyperIndex indexer for the prize pool |
| `api` | The app ↔ platform contract (OpenAPI); the app's types are generated from it |
| `docs` | Architecture decision records, fee model, economics |

Why it is arranged this way: [ADR 0002](docs/adr/0002-repository-layout.md).

## Run it

### Platform (Go 1.26, Postgres)

```bash
cd services
cp .env.example .env            # fill in the Perpl key, builder id, database URL
docker compose up -d            # Postgres on :5433
go test ./...
PLATFORM_OWN_ACCOUNT=1 go run ./cmd/platform
```

Everything defaults to **testnet**. Mainnet requires `PERPL_ALLOW_MAINNET=1`
alongside `PERPL_NETWORK=mainnet`.

What the platform needs, and what each part turns on:

| Variable | Turns on |
|---|---|
| `PERPL_API_KEY`, `PERPL_API_KEY_SECRET` | the platform's own venue connection: market data, signals |
| `PERPL_BUILDER_ID` | enrolling users' keys with the builder code |
| `DATABASE_URL` | keys, policy state, the trade journal, prizes; without it, memory only |
| `PLATFORM_KEY_ENCRYPTION_KEY` | users' exchange keys sealed at rest (AES-256-GCM) |
| `PLATFORM_SETTLER_KEY`, `PLATFORM_PRIZE_POOL_ADDRESS` | funding and settling the on-chain prize pool |
| `NANSEN_API_KEY` | the on-chain context card |
| `AURORA_API_KEY` | any-chain deposits |
| `ENVIO_GRAPHQL_URL` | the lobby's prize history |
| `PLATFORM_OWN_ACCOUNT=1` | trading the platform's own account through the API — development and tests only |

A second venue key for a laptop running beside the hosted platform goes in
`services/.env.local`, which overrides `.env`.

### App (Node 22, Expo)

```bash
cd apps/mobile
npm install
npm run gen:api                 # types from ../../api/openapi.yaml
npm run link:chart              # the TradingView Charting Library (licensed; not in the repository)
npm run web                     # web build against http://localhost:8080
```

On a phone with Expo Go, set `EXPO_PUBLIC_API_URL` to the laptop's LAN
address and run the platform with `PLATFORM_ADDR=0.0.0.0:8080`. Passkeys
need HTTPS: the live site, or a tunnel.

Browser tests run the whole loop against a local platform on testnet — real
enrollment, real fills:

```bash
npm run web:export && npx playwright test
```

### Contracts (Foundry)

```bash
cd contracts
forge test
forge script script/Deploy.s.sol --rpc-url https://testnet-rpc.monad.xyz --broadcast
```

Deployed on Monad testnet: `StrategyPrizePool` at
`0x19952068Ce2D25C672d71cD48775A9f43438f4E6` over AUSD.

### Indexer (Envio)

```bash
cd indexers/prize-pool
pnpm install && pnpm test
pnpm envio local docker up && pnpm envio start --config config.local.yaml
```

The hosted deployment builds from `main`; see the indexer's
[README](indexers/prize-pool/README.md).

## Trading against Perpl by hand

```bash
cd services
go run ./cmd/perplcheck          # read-only: markets, candles, account
go run ./cmd/perplcheck -trade   # opens a position and closes it again
go run ./cmd/breakeven           # the fee threshold every strategy's parameters derive from
```

Placing an order needs an enrolled API key with the `trade` scope, an
exchange account funded with the venue's minimum collateral, and
`allowOrderForwarding(true)` from the account's wallet — without the last
one, orders are acknowledged and then fail with reason 34.
