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
    await page.goto('/direction');
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
    await expect(page.getByText(/^unrealized · fees paid [\d.]+( · closes in \d+:\d\d)?$/)).toBeVisible();

    // Buttons flip: no Up/Down while a position is open, only Close.
    await expect(page.getByRole('button', { name: 'Up', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Close position', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Close position', exact: true }).click();
    // The screen shows the fee the close was charged (the builder fee since
    // trades go through the platform's own key).
    await expect(page.getByText(/^Closed \d+ @ [\d.]+, fee [\d.]+$/)).toBeVisible();
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

  // The horizon is the strategy's exit. The screen sends it with the tap,
  // counts down to it, and explains the close after the platform made it.
  // The presets are minutes long; this opens through the API with the
  // shortest horizon the platform accepts so the test sees the whole arc.
  test('a horizon closes the position and the screen says so', async ({ page }) => {
    await ensureFlat(page);
    await expect(page.getByRole('button', { name: 'Horizon 15m', exact: true })).toBeVisible();

    // The previous test's refusal leaves a cooldown running; wait it out.
    let status = 0;
    for (let attempt = 0; attempt < 4 && status !== 200; attempt++) {
      const res = await page.request.post('http://localhost:8080/v1/orders/open', {
        data: { symbol: 'MON', side: 'long', notional: '5', leverage: '2', horizon_seconds: 12 },
      });
      status = res.status();
      if (status === 403) {
        const body = (await res.json()) as { retry_after_seconds?: number };
        await page.waitForTimeout(((body.retry_after_seconds ?? 5) + 1) * 1000);
      } else if (status === 503) {
        // The venue connection is being re-established; give it a moment.
        await page.waitForTimeout(5000);
      }
    }
    expect(status).toBe(200);
    await expect(page.getByTestId('position-footer')).toHaveText(/closes in 00:(0|1)\d/, { timeout: 15_000 });
    await expect(page.getByTestId('notice')).toHaveText(/^Closed by timer @ [\d.]+, [+-]?[\d.]+$/, { timeout: 40_000 });
    await expect(page.getByText('No position')).toBeVisible();

    // The round trip is in this strategy's history, on both tabs.
    await expect(page.getByTestId('history-position').first()).toContainText(/Up · \d+ @ [\d.]+ → [\d.]+/);
    await page.getByRole('button', { name: 'History Orders', exact: true }).click();
    await expect(page.getByTestId('history-order').first()).toContainText(/Close Up · timer/);
  });
});
