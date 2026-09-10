import { expect, test } from '@playwright/test';

/**
 * The lobby lists every strategy with this week's board, straight from the
 * platform's ledger, and opens the strategy's own screen on a tap.
 */
test('the lobby shows each strategy with its week and opens it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/^STRATEGIES · THIS WEEK$/)).toBeVisible();
  await expect(page.getByText(/^Balance /)).toBeVisible();

  for (const id of ['direction', 'ma-cross', 'rsi']) {
    const card = page.getByTestId(`strategy-${id}`);
    await expect(card).toBeVisible();
    await expect(card.getByTestId(`board-pnl-${id}`)).toHaveText(/^[+-]?\d+(\.\d+)?$/);
    await expect(card.getByText(/\d+ (player|players) · \d+ (trade|trades) · /)).toBeVisible();
  }

  // The weekly prize lives in a contract; each card shows its pool.
  await expect(page.getByTestId('prize-pool-direction')).toHaveText(/^Prize pool [\d.]+ AUSD$/);
  await expect(page.getByTestId('leaderboard-source')).toHaveText(/^Prizes paid by contract 0x[0-9a-f]{4}…[0-9a-f]{4} · week \d+/);

  await page.getByRole('link', { name: 'Play Direction', exact: true }).click();
  await expect(page.getByText(/^DIRECTION · MON$/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Up', exact: true })).toBeVisible();
});

// The chain's record of the prize pools, from the indexer, sits under the
// strategies: before the first settlement it says so.
test('the lobby shows the on-chain prize pools from the indexer', async ({ page }) => {
  await page.goto('/');
  const past = page.getByTestId('past-weeks');
  await expect(past).toBeVisible({ timeout: 20_000 });
  await expect(past).toContainText(/PRIZE POOLS/);
  await expect(past).toContainText(/pools · [\d.]+ AUSD funded/);
  await expect(past).toContainText(/Indexed by Envio/);
});
