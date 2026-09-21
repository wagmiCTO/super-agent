# prize-pool — Envio HyperIndex for TradeAgent's weekly prizes

Indexes `StrategyPrizePool` on Monad testnet (chain 10143, contract
`0x1cC7f88b21E0158e70323aad98Dea4dC20b380aC`, from block 63267538) into
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

Envio's hosted service builds from this directory (indexer `prize-pool` in the
`wagmicto` organisation, root `indexers/prize-pool`), but **a push to `main` is
not enough on its own**. The development plan allows three active deployments,
and once all three slots are taken every later commit is simply refused with
"you've reached the maximum number of active deployments". A push that looks
ignored usually means the slots are full, not that the hook is broken.

So a redeploy is three steps in the dashboard:

1. Delete an old deployment to free a slot. It asks you to type
   `prize-pool-<commit>` to confirm, and it cannot be undone.
2. Deploy the commit you want from *Latest Commits*. A full historical sync of
   this contract takes about a minute.
3. Copy the new deployment's GraphQL endpoint into `ENVIO_GRAPHQL_URL` on the
   platform service and redeploy it.

Step 3 is needed because **every deployment gets its own endpoint hash** — the
URL changes under you on each redeploy. A deployment can instead be *promoted*
to the indexer's static production endpoint, which does not change; do that and
step 3 becomes a one-off.

Two things worth knowing before changing `config.yaml`:

- **Changing the contract address does not move an existing deployment.** The
  running indexer keeps its own database and goes on watching the address it
  was built with. Only a new deployment reads the new address, so an address
  change always means a redeploy, not just a push.
- Each active deployment burns indexing hours whether or not anything reads it.
  Deployments left behind from old commits are the usual reason the plan's
  included hours run out.
