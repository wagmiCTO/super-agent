import { expect, test } from '@playwright/test';

/**
 * Strategy #2 renders from the platform's live signal: the chart, which
 * average is on top, and either an open window with a one-sided entry or the
 * wait for the next cross. A cross cannot be forced on testnet, so the entry
 * itself is exercised by the Direction tests through the same trading hook.
 */
test('MA Cross screen shows the live signal and offers only the cross side', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Play MA Cross', exact: true }).click();
  await expect(page.getByText(/^MA CROSS · MON$/)).toBeVisible();
  // The stack keeps Direction mounted underneath; the balance line on top is this screen's.
  await expect(page.getByText(/^Balance /).last()).toBeVisible();

  const trend = page.getByTestId('signal-trend');
  await expect(trend).toHaveText(/^5\/20 · 1m · trend (up|down|flat)$/, { timeout: 20_000 });
  await expect(page.getByTestId('signal-chart')).toBeVisible();

  const window = page.getByTestId('signal-window');
  if (await window.isVisible()) {
    // A window offers exactly one direction, the cross's own.
    const text = await window.textContent();
    const side = text?.startsWith('Up') ? 'Up' : 'Down';
    const other = side === 'Up' ? 'Down' : 'Up';
    await expect(page.getByRole('button', { name: side, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: other, exact: true })).toHaveCount(0);
  } else {
    await expect(page.getByTestId('signal-waiting')).toHaveText(/Waiting for the next cross/);
    await expect(page.getByRole('button', { name: 'Up', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Down', exact: true })).toHaveCount(0);
  }

  await page.getByRole('link', { name: '← Lobby' }).click();
  await expect(page.getByText(/^STRATEGIES · THIS WEEK$/).last()).toBeVisible();
});
