import { expect, test } from '@playwright/test';

import { asReturningUser } from './onboarded';

/**
 * The lobby lists every strategy with this week's board, straight from the
 * platform's ledger, and opens the strategy's own screen on a tap.
 */
test('the lobby shows each strategy with its week and opens it', async ({ page, context }) => {
  await asReturningUser(page, context);
  await expect(page.getByText('Choose a strategy')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('balance')).toHaveText(/^[\d.]+ AUSD$|^offline$|^…$/);

  for (const id of ['direction', 'ma-cross', 'rsi']) {
    const card = page.getByTestId(`strategy-${id}`);
    await expect(card).toBeVisible();
    // The week, in the design's money: a real minus sign and two decimals.
    await expect(card.getByTestId(`board-pnl-${id}`)).toHaveText(/^[+\u2212]?\d+\.\d\d this week · \d+ (trade|trades)$/);
    // The card's second line: the pool and who is in it.
    await expect(card.getByTestId(`prize-pool-${id}`)).toHaveText(/(Pool [\d.]+ AUSD|No pool yet) · \d+ (player|players)/);
  }

  await expect(page.getByTestId('leaderboard-source')).toHaveText(/^Prizes paid by contract 0x[0-9a-f]{4}…[0-9a-f]{4} · week \d+/);

  await page.getByTestId('strategy-direction').click({ force: true });
  // The lobby stays mounted under the strategy in the navigator stack, so the
  // name appears twice — the screen on top is the last one.
  await expect(page).toHaveURL(/\/direction$/, { timeout: 20_000 });
  await expect(page.getByTestId('key-up').last()).toBeVisible({ timeout: 20_000 });
});

// The chain's record of the prize pools, from the indexer, sits under the
// strategies: before the first settlement it says so.
test('the lobby shows the on-chain prize pools from the indexer', async ({ page, context }) => {
  await asReturningUser(page, context);
  const past = page.getByTestId('past-weeks');
  await expect(past).toBeVisible({ timeout: 20_000 });
  await expect(past).toContainText(/PRIZE POOLS/);
  await expect(past).toContainText(/pools · [\d.]+ AUSD funded/);
  await expect(past).toContainText(/Indexed by Envio/);
});
