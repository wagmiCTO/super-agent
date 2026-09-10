/**
 * StrategyPrizePool → Pool / Prize / Funding / Claim / Totals.
 *
 * The contract emits one Funded per platform batch, one Settled per week
 * and strategy with the winners and their shares, and one Claimed per
 * payout. The entities here are what a leaderboard or a dashboard reads:
 * a pool's life in one row, and each prize with whether it was collected.
 */
import { indexer } from "envio";
import type { Claim, Funding, Pool, Prize, Totals } from "envio";

const TOTALS_ID = "all";

const poolId = (week: bigint, strategy: string) => `${week}-${strategy}`;
const prizeId = (week: bigint, strategy: string, wallet: string) => `${week}-${strategy}-${wallet.toLowerCase()}`;

async function loadTotals(context: { Totals: { get: (id: string) => Promise<Totals | undefined> } }): Promise<Totals> {
  return (
    (await context.Totals.get(TOTALS_ID)) ?? {
      id: TOTALS_ID,
      funded: 0n,
      paid: 0n,
      claimed: 0n,
      pools: 0,
      settledPools: 0,
    }
  );
}

async function loadPool(
  context: { Pool: { get: (id: string) => Promise<Pool | undefined> } },
  week: bigint,
  strategy: string,
): Promise<{ pool: Pool; created: boolean }> {
  const existing = await context.Pool.get(poolId(week, strategy));
  if (existing) return { pool: existing, created: false };
  return {
    created: true,
    pool: {
      id: poolId(week, strategy),
      week,
      strategy,
      funded: 0n,
      fundings: 0,
      settled: false,
      settledAt: undefined,
      carried: 0n,
      winners: 0,
      claimed: 0n,
    },
  };
}

indexer.onEvent({ contract: "StrategyPrizePool", event: "Funded" }, async ({ event, context }) => {
  const { week, strategy, from, amount, total } = event.params;
  const { pool, created } = await loadPool(context, week, strategy);
  const totals = await loadTotals(context);
  context.Pool.set({ ...pool, funded: total, fundings: pool.fundings + 1 });
  const funding: Funding = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    pool_id: pool.id,
    week,
    strategy,
    from,
    amount,
    total,
    timestamp: BigInt(event.block.timestamp),
    tx: event.transaction.hash,
  };
  context.Funding.set(funding);
  context.Totals.set({ ...totals, funded: totals.funded + amount, pools: totals.pools + (created ? 1 : 0) });
});

indexer.onEvent({ contract: "StrategyPrizePool", event: "Settled" }, async ({ event, context }) => {
  const { week, strategy, winners, amounts, pnls, carried } = event.params;
  const { pool, created } = await loadPool(context, week, strategy);
  const totals = await loadTotals(context);
  let paid = 0n;
  winners.forEach((wallet, i) => {
    const amount = amounts[i] ?? 0n;
    const prize: Prize = {
      id: prizeId(week, strategy, wallet),
      pool_id: pool.id,
      week,
      strategy,
      wallet: wallet.toLowerCase(),
      rank: i + 1,
      amount,
      pnl: pnls[i] ?? 0n,
      claimed: false,
      claimedAt: undefined,
      claimTx: undefined,
    };
    paid += amount;
    context.Prize.set(prize);
  });
  context.Pool.set({
    ...pool,
    settled: true,
    settledAt: BigInt(event.block.timestamp),
    carried,
    winners: winners.length,
  });
  context.Totals.set({
    ...totals,
    paid: totals.paid + paid,
    pools: totals.pools + (created ? 1 : 0),
    settledPools: totals.settledPools + 1,
  });
});

indexer.onEvent({ contract: "StrategyPrizePool", event: "Claimed" }, async ({ event, context }) => {
  const { week, strategy, wallet, amount } = event.params;
  const id = prizeId(week, strategy, wallet);
  const prize = await context.Prize.get(id);
  const totals = await loadTotals(context);
  if (prize) {
    context.Prize.set({ ...prize, claimed: true, claimedAt: BigInt(event.block.timestamp), claimTx: event.transaction.hash });
    const pool = await context.Pool.get(prize.pool_id);
    if (pool) context.Pool.set({ ...pool, claimed: pool.claimed + amount });
  }
  const claim: Claim = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    prize_id: id,
    wallet: wallet.toLowerCase(),
    amount,
    timestamp: BigInt(event.block.timestamp),
    tx: event.transaction.hash,
  };
  context.Claim.set(claim);
  context.Totals.set({ ...totals, claimed: totals.claimed + amount });
});
