import { expect, test } from '@playwright/test';

/**
 * The lobby lists every strategy with this week's board, straight from the
 * platform's ledger, and opens the strategy's own screen on a tap.
 */
test('the lobby shows each strategy with its week and opens it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/^STRATEGIES · THIS WEEK$/)).toBeVisible();
  await expect(page.getByText(/^Balance /)).toBeVisible();

  for (const id of ['direction', 'ma-cross']) {
    const card = page.getByTestId(`strategy-${id}`);
    await expect(card).toBeVisible();
    await expect(card.getByTestId(`board-pnl-${id}`)).toHaveText(/^[+-]?\d+(\.\d+)?$/);
    await expect(card.getByText(/\d+ (player|players) · \d+ (trade|trades) · /)).toBeVisible();
  }

  // The board is read from the contract, and the screen says so.
  await expect(page.getByTestId('leaderboard-source')).toHaveText(/^Settled on Monad · contract 0x[0-9a-f]{4}…[0-9a-f]{4} · week \d+$/);

  await page.getByRole('link', { name: 'Play Direction', exact: true }).click();
  await expect(page.getByText(/^DIRECTION · MON$/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Up', exact: true })).toBeVisible();
});
