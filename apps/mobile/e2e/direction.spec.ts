import { expect, test, type Page } from '@playwright/test';

/**
 * The Sprint 1 gate, automated: a tap opens a real position on testnet, the
 * screen shows one number for it, and a second tap closes it.
 *
 * Requires the platform on :8080 with testnet credentials and a funded
 * account. Every assertion reads what the screen shows the player; the
 * server log is not consulted.
 */
/**
 * Waits until the screen is flat, closing a leftover position if there is one.
 * The venue's position snapshot lags a close by a poll or two, so a test that
 * starts right after another one's close must not assume the presets are back.
 */
async function ensureFlat(page: Page) {
  const closeButton = page.getByRole('button', { name: 'Close position', exact: true });
  const noPosition = page.getByText('No position');
  await expect(closeButton.or(noPosition)).toBeVisible();
  if (await closeButton.isVisible()) {
    await closeButton.click();
  }
  await expect(noPosition).toBeVisible();
  await expect(page.getByRole('button', { name: 'Up', exact: true })).toBeVisible();
}

test.describe('Direction screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // The balance line only appears once /v1/state has answered.
    await expect(page.getByText(/^Balance /)).toBeVisible();
  });

  test('shows the cost of a round trip before any position exists', async ({ page }) => {
    await ensureFlat(page);
    // Fee line comes from the venue's live schedule, not a constant in the app.
    await expect(page.getByText(/round trip costs .* \(\d+(\.\d+)? bps\)/)).toBeVisible();
    await expect(page.getByText(/^Limits: up to /)).toBeVisible();
  });

  test('opens on Up, shows unrealized PnL, closes on Close', async ({ page }) => {
    await ensureFlat(page);

    await page.getByRole('button', { name: 'Amount 20', exact: true }).click();
    await expect(page.getByTestId('big-number')).toHaveText('20');
    await page.getByRole('button', { name: 'Up', exact: true }).click();

    // A fill is reported with size and price; the venue's fee is shown too.
    await expect(page.getByText(/^Filled \d+ @ [\d.]+, fee [\d.]+$/)).toBeVisible();

    // The one number: a signed unrealized PnL under a position caption.
    await expect(page.getByText(/^Up · \d+ MON @ [\d.]+ · 2x$/)).toBeVisible();
    await expect(page.getByText(/^unrealized · fees paid [\d.]+$/)).toBeVisible();

    // Buttons flip: no Up/Down while a position is open, only Close.
    await expect(page.getByRole('button', { name: 'Up', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Close position', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Close position', exact: true }).click();
    // Closing is free on this venue; the screen shows the fee it was charged.
    await expect(page.getByText(/^Closed \d+ @ [\d.]+, fee 0$/)).toBeVisible();
    await expect(page.getByText('No position')).toBeVisible();
  });

  test('a policy refusal is shown in words, with the limit', async ({ page }) => {
    await ensureFlat(page);
    // A cooldown from the previous test may still be running; let it lapse.
    await page.waitForTimeout(6_000);

    await page.getByRole('button', { name: 'Amount 5', exact: true }).click();
    await page.getByRole('button', { name: 'Down', exact: true }).click();
    await expect(page.getByText(/^Down · \d+ MON/)).toBeVisible();
    await page.getByRole('button', { name: 'Close position', exact: true }).click();
    await expect(page.getByText('No position')).toBeVisible();

    // The open above started a 5s cooldown; a second open inside it is refused.
    await page.getByRole('button', { name: 'Up', exact: true }).click();
    await expect(page.getByText(/^Wait \d+s before opening again$/)).toBeVisible();
  });
});
