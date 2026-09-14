import { expect, test } from '@playwright/test';

import { asReturningUser } from './onboarded';

/**
 * Strategy #3 renders from the platform's live RSI signal: the chart with the
 * index in its own pane, and either a zone naming a side or the wait.
 *
 * Zones come once or twice a day, so the quiet screen is the one most visits
 * see and the one worth asserting: it must say what it is waiting for rather
 * than look broken.
 */
test('RSI shows the index and keeps both keys', async ({ page, context }) => {
  await asReturningUser(page, context);
  await page.goto('/rsi');

  await expect(page.getByText('RSI Bounce', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('signal-chart')).toBeVisible();

  const lit = page.getByTestId('signal-lit');
  if (await lit.isVisible().catch(() => false)) {
    await expect(lit).toHaveText(/SIGNAL · (UP|DOWN)/);
    await expect(lit).toContainText(/RSI \d{1,3}/);
  } else {
    const waiting = page.getByTestId('signal-waiting');
    await expect(waiting).toContainText('No signal now');
    await expect(waiting).toContainText(/waiting for a zone|warming up/);
  }

  await expect(page.getByTestId('key-up')).toBeVisible();
  await expect(page.getByTestId('key-down')).toBeVisible();
});
