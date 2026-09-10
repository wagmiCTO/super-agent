/**
 * The handlers against simulated events: a pool fills, settles into prizes,
 * and a prize is claimed — with the totals following along.
 */
import { describe, it } from "vitest";
import { createTestIndexer, TestHelpers } from "envio";

const CHAIN = 10143;
const WEEK = 2958n;
const DIRECTION = "0xb15bcb4cd55f627372ab4c4a821dbf8833ea3fea61eecef2b39d7eee09f8092d";
const settler = TestHelpers.Addresses.defaultAddress;
const alice = TestHelpers.Addresses.mockAddresses[1]!;
const bob = TestHelpers.Addresses.mockAddresses[2]!;

describe("StrategyPrizePool", () => {
  it("funds, settles and pays a pool", async (t) => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            { contract: "StrategyPrizePool", event: "Funded", params: { week: WEEK, strategy: DIRECTION, from: settler, amount: 100000n, total: 100000n } },
            { contract: "StrategyPrizePool", event: "Funded", params: { week: WEEK, strategy: DIRECTION, from: settler, amount: 200000n, total: 300000n } },
          ],
        },
      },
    });
    const poolId = `${WEEK}-${DIRECTION}`;
    let pool = await indexer.Pool.getOrThrow(poolId);
    t.expect(pool.funded).toBe(300000n);
    t.expect(pool.fundings).toBe(2);
    t.expect(pool.settled).toBe(false);
    let totals = await indexer.Totals.getOrThrow("all");
    t.expect(totals.funded).toBe(300000n);
    t.expect(totals.pools).toBe(1);
    t.expect((await indexer.Funding.getAll()).length).toBe(2);

    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            {
              contract: "StrategyPrizePool",
              event: "Settled",
              params: { week: WEEK, strategy: DIRECTION, winners: [alice, bob], amounts: [150000n, 90000n], pnls: [3000000n, 1000000n], carried: 60000n },
            },
          ],
        },
      },
    });
    pool = await indexer.Pool.getOrThrow(poolId);
    t.expect(pool.settled).toBe(true);
    t.expect(pool.winners).toBe(2);
    t.expect(pool.carried).toBe(60000n);
    const first = await indexer.Prize.getOrThrow(`${WEEK}-${DIRECTION}-${alice.toLowerCase()}`);
    t.expect(first.rank).toBe(1);
    t.expect(first.amount).toBe(150000n);
    t.expect(first.pnl).toBe(3000000n);
    t.expect(first.claimed).toBe(false);
    totals = await indexer.Totals.getOrThrow("all");
    t.expect(totals.paid).toBe(240000n);
    t.expect(totals.settledPools).toBe(1);

    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [{ contract: "StrategyPrizePool", event: "Claimed", params: { week: WEEK, strategy: DIRECTION, wallet: alice, amount: 150000n } }],
        },
      },
    });
    const claimed = await indexer.Prize.getOrThrow(`${WEEK}-${DIRECTION}-${alice.toLowerCase()}`);
    t.expect(claimed.claimed).toBe(true);
    t.expect(typeof claimed.claimTx).toBe("string");
    pool = await indexer.Pool.getOrThrow(poolId);
    t.expect(pool.claimed).toBe(150000n);
    totals = await indexer.Totals.getOrThrow("all");
    t.expect(totals.claimed).toBe(150000n);
    t.expect((await indexer.Claim.getAll()).length).toBe(1);
  });

  it("settles a pool it never saw funded", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            { contract: "StrategyPrizePool", event: "Settled", params: { week: WEEK, strategy: DIRECTION, winners: [alice], amounts: [50000n], pnls: [-1n], carried: 0n } },
          ],
        },
      },
    });
    const pool = await indexer.Pool.getOrThrow(`${WEEK}-${DIRECTION}`);
    t.expect(pool.funded).toBe(0n);
    t.expect(pool.settled).toBe(true);
    const totals = await indexer.Totals.getOrThrow("all");
    t.expect(totals.pools).toBe(1);
    t.expect(totals.paid).toBe(50000n);
  });
});
