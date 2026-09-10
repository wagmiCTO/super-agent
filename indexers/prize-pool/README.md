# prize-pool — Envio HyperIndex for TradeAgent's weekly prizes

Indexes `StrategyPrizePool` on Monad testnet (chain 10143, contract
`0x19952068Ce2D25C672d71cD48775A9f43438f4E6`, from block 61410716) into
what a leaderboard or a dashboard reads:

- `Pool` — one row per (week, strategy): funded total, number of fundings,
  settled or not, carried amount, winners, claimed total.
- `Prize` — one row per winner: rank, amount, the PnL that earned it,
  claimed or not and the claim transaction.
- `Funding`, `Claim` — the raw events, linked to their pool and prize.
- `Totals` — one row with the sums across every week.

The strategy key is `keccak256(strategy id)`: `direction`, `ma-cross`,
`rsi` (see `services/internal/platform/prize.go`).

## Run locally

Needs Docker and Node 22+.

```sh
pnpm install
pnpm envio local docker up         # Postgres + Hasura; set ENVIO_PG_PORT / HASURA_EXTERNAL_PORT if 5433 or 8080 are taken
pnpm envio start --config config.local.yaml
```

`config.local.yaml` syncs over Monad's public RPC (100-block `eth_getLogs`
windows, so the first sync takes a while); `config.yaml` is the hosted
configuration and uses HyperSync, which needs `ENVIO_API_TOKEN`.

Hasura is then on http://localhost:8085 (console password `testing`):

```graphql
{ Pool(order_by: {week: desc}) { week strategy funded settled winners claimed }
  Totals { funded paid claimed pools settledPools } }
```

## Deploy

Envio's hosted service builds from this directory on push: connect the
repository at https://envio.dev/app, root `indexers/prize-pool`. The
platform reads the deployed GraphQL endpoint from `ENVIO_GRAPHQL_URL`.
