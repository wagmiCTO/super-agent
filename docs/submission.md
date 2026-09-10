# TradeAgent — submission notes (draft)

Track: Onchain Finance & Trading. A working draft of the write-up; the
final text is pasted into the submission form.

## What it is

Trading a perp on your phone is a screen full of leverage, order types,
take-profits and timers. TradeAgent turns that into strategy games. Each
strategy is one framed decision — Direction: up or down, an amount, a
horizon; MA Cross: take the side the trend just turned to; RSI Bounce: fade
a crowd that overdid it — and the platform does the rest: policy limits,
execution at Perpl, and the exit, on time, whether the app is open or not.
Every strategy has a weekly leaderboard and an on-chain prize pool.

It is "new order types via better UI": a strategy is a compound order —
leverage, size, timer, exit — packaged as a screen a person can read in
three seconds.

## How it works

- **Account**: a passkey. Its PRF output derives a wallet (the exchange
  account's owner), a request-signing key, and one Ed25519 exchange API
  key per strategy. The wallet never leaves the device; each strategy's
  key is enrolled at Perpl with the platform's builder code and trades
  under its own limits. One passkey, many keys (ADR 0005).
- **Execution**: Perpl on Monad, through the venue's API with an enrolled
  key and builder code. The platform holds strategy keys sealed at rest;
  they cannot withdraw.
- **Policy engine**: every order passes notional, leverage, exposure,
  daily-loss and cooldown checks before the venue sees it; refusals come
  back in words with the limit that was hit.
- **Signals**: MA Cross (5/20 on one-minute bars) and RSI(14) run on the
  platform's market-data connection; the screen lights up for a few
  minutes when a signal fires. The signal is a hint; the tap is the user's.
- **Prizes**: `StrategyPrizePool` on Monad testnet. Every closed round trip
  adds to its strategy's weekly pool; the platform settles the previous
  week from its trade journal (50/30/20 to the top three with a positive
  result); winners claim from the contract themselves.
- **Risk**: every position carries a stop the user picks with the tap
  (−25% / −50% of collateral, or none), judged on the venue's own mark and
  closed by the platform; the risk screen shows what is at risk now across
  strategies, each strategy's loss budget and exposure against its limits,
  how its round trips went today, this week and ever (hit rate, fees,
  drawdown, who closed), the distance to liquidation, and the market's
  one-minute volatility against the round-trip fee. One button closes
  everything.
- **Context**: before an entry, a card built from Nansen — the asset's day,
  who has been buying and selling, one sentence that says it.
- **Deposits**: collateral from any chain through Aurora Intents — a
  one-time deposit address, funds land in the wallet on Monad.
- **Indexing**: an Envio HyperIndex indexer over the prize pool serves the
  lobby's history of weeks, winners and claims.

## Integrations claimed

| Bounty | What is integrated | Where |
|---|---|---|
| Agora — mobile trading app | Mera passkey accounts, AUSD collateral, Perpl execution, the whole loop on a phone | `apps/mobile`, `services/internal/venue/perpl` |
| Perpl — best use of the API | Enrollment with builder code, trading over REST+WS, reconciliation, horizon exits, fee-aware strategy parameters | `services/internal/venue/perpl`, `services/internal/platform` |
| Mera — best UX / one passkey, many keys | Passkey → wallet + request key + per-strategy exchange keys; signed requests; no seed, no extension | `apps/mobile/src/account/derive.ts`, ADR 0005 |
| Perpl — analytics / risk tool | Stops per tap, per-strategy limits and loss budgets, the risk screen (open risk, drawdown, liquidation distance, fee vs volatility), close-everything | `services/internal/platform/risk.go`, `apps/mobile/src/app/risk.tsx` |
| Nansen | The on-chain context card on every strategy screen | `services/internal/insight`, `apps/mobile/src/components/context.tsx` |
| Aurora Intents | Any-chain deposits into the wallet | `services/internal/deposit`, `apps/mobile/src/app/deposit.tsx` |
| Envio | Prize-pool indexer, hosted; the lobby's past weeks | `indexers/prize-pool` |

## Links

- App: https://inflight.work
- Platform API: https://platform-production-bf25.up.railway.app (OpenAPI in `api/openapi.yaml`)
- Prize pool: `0x19952068Ce2D25C672d71cD48775A9f43438f4E6` on Monad testnet
- Indexer: https://indexer.dev.hyperindex.xyz/efd72aa/v1/graphql
- Repository: https://github.com/wagmiCTO/super-agent

## Honest limits

- Testnet only. Perpl's testnet is where the exchange account, the fills
  and the prizes are.
- Strategy keys share one exchange account, so two strategies on the same
  market share a position at the venue; limits are per strategy, positions
  are not.
- Aurora delivers to Monad mainnet and currently asks for at least $1,000
  per deposit; the demo shows the flow, not a testnet top-up.
- Nansen's free plan meters credits; the card refreshes every few hours.
