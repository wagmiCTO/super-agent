import { expect, test, type Page } from '@playwright/test';

/**
 * The Sprint 1 gate, automated: a tap opens a real position on testnet, the
 * screen shows one number for it, and a second tap closes it.
 *
 * Requires the platform on :8080 with testnet credentials and a funded
 * account. Every assertion reads what the screen shows the player; the
 * server log is not consulted.
 *
 * The screen asks nothing before the tap — size, leverage, stop and horizon
 * are the standard position, set once on `/settings` — so these specs press
 * the key and read the result, which is the whole interaction now.
 */

/**
 * Waits until the screen is flat, closing a leftover position if there is one.
 * The venue's position snapshot lags a close by a poll or two, so a test that
 * starts right after another one's close must not assume the keys are back.
 */
async function ensureFlat(page: Page) {
  const close = page.getByTestId('close-position');
  const up = page.getByTestId('key-up');
  await expect(close.or(up)).toBeVisible({ timeout: 30_000 });
  if (await close.isVisible()) await close.click();
  await expect(up).toBeVisible({ timeout: 30_000 });
}

test.describe('Direction screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/direction');
    // The keys only come alive once /v1/state has answered.
    await expect(page.getByTestId('key-up').or(page.getByTestId('close-position'))).toBeVisible({ timeout: 30_000 });
  });

  test('asks its question and says what a tap opens', async ({ page }) => {
    await ensureFlat(page);
    await expect(page.getByTestId('says')).toHaveText(/^Where does MON go in the next \d+ minutes\?$/);
    // The standard position, on the screen, before anything is pressed.
    await expect(page.getByTestId('settings-chip')).toContainText('AUSD');
    await expect(page.getByTestId('settings-chip')).toContainText(/At risk/i);
    // The limits line is gone from under the history, as the design has it:
    // the limits are the risk screen's to show.
    await expect(page.getByText(/^Up to \d+ per position · /)).toHaveCount(0);
  });

  test('shows what the crowd on-chain is doing with the asset', async ({ page }) => {
    const card = page.getByTestId('context-card');
    await expect(card).toBeVisible({ timeout: 30_000 });
    // Folded: the lean and the day's flow. It opens on a tap.
    await expect(page.getByTestId('context-lean')).toHaveText(/Buyers ahead|Sellers ahead|Even/);
    await card.click();
    await expect(page.getByTestId('context-headline')).toHaveText(/WMON is .* on \$[\d.]+[kMB]? of volume in 24h\./);
    await expect(card).toContainText(/Nansen/);
  });

  test('opens on Up, shows unrealized PnL, closes on Close', async ({ page }) => {
    await ensureFlat(page);
    await page.getByTestId('key-up').click();

    // A fill is reported with size and price; the venue's fee is shown too.
    await expect(page.getByTestId('notice')).toHaveText(/^Filled \d+ @ [\d.]+, fee [\d.]+$/, { timeout: 40_000 });

    // The screen becomes the position: one signed number and its caption.
    await expect(page.getByTestId('open-position')).toContainText(/^Up/, { timeout: 30_000 });
    // A typographic minus, not a hyphen: the design's money() says so.
    await expect(page.getByTestId('big-number')).toHaveText(/^[+\u2212]?[\d.]+$/);
    await expect(page.getByTestId('position-footer')).toHaveText(/^AUSD · in at [\d.]+ · fees [\d.]+$/);

    // The keys are gone while a position is open: the only call left is Close.
    await expect(page.getByTestId('key-up')).toHaveCount(0);
    await page.getByTestId('close-position').click();
    await expect(page.getByTestId('notice')).toHaveText(/^Closed \d+ @ [\d.]+, fee [\d.]+$/, { timeout: 40_000 });
    await expect(page.getByTestId('key-up')).toBeVisible({ timeout: 30_000 });
  });

  /** Waits out the pause between two taps, whatever the wallet set it to. */
  async function ensureCooldownOver(page: Page) {
    const state = await page.evaluate(() => (window as unknown as { __tradeagent?: { state: (s: string) => Promise<{ limits: { cooldown_seconds: number } }> } }).__tradeagent?.state('direction'));
    await page.waitForTimeout(((state?.limits.cooldown_seconds ?? 10) + 2) * 1000);
  }

  test('a policy refusal is shown in words, with the limit', async ({ page }) => {
    await ensureFlat(page);
    // Past the cooldown the previous test's tap started. It is the safe
    // tier's own — ten seconds since the limits became the wallet's choice,
    // not the five this waited for when it was written.
    await ensureCooldownOver(page);

    await page.getByTestId('key-down').click();
    await expect(page.getByTestId('open-position')).toContainText(/^Down/, { timeout: 40_000 });
    await page.getByTestId('close-position').click();
    await expect(page.getByTestId('key-up')).toBeVisible({ timeout: 30_000 });

    // The open above started the cooldown again; a second open inside it is
    // refused, in words, with the wait.
    await page.getByTestId('key-up').click();
    await expect(page.getByTestId('notice')).toHaveText(/^Wait \d+s before opening again$/, { timeout: 20_000 });
  });

  /**
   * The horizon is the strategy's exit. The screen sends it with the tap,
   * counts down to it, and explains the close after the platform made it.
   * The standard position's horizon is minutes long; this opens through the
   * API with the shortest horizon the platform accepts so the test sees the
   * whole arc inside one run.
   */
  test('a horizon closes the position and the screen says so', async ({ page }) => {
    await ensureFlat(page);

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
    await expect(page.getByTestId('open-position')).toContainText(/Closes in/, { timeout: 15_000 });
    await expect(page.getByTestId('notice')).toHaveText(/^Closed by timer @ [\d.]+, [+-]?[\d.]+$/, { timeout: 40_000 });
    await expect(page.getByTestId('key-up')).toBeVisible({ timeout: 30_000 });

    // The round trip is in this strategy's history, on both tabs.
    await expect(page.getByTestId('history-position').first()).toContainText(/Up · [\d.]+ → [\d.]+/);
    await page.getByTestId('history-orders').click();
    await expect(page.getByTestId('history-order').first()).toContainText(/Close Up · @ [\d.]+/);
  });
});
