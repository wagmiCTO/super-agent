import { expect, test } from '@playwright/test';

import { asReturningUser } from './onboarded';

/**
 * Strategy #5 renders from the platform's live opening-range signal: the
 * session on the clock, its range on the chart once its first bars have
 * closed, and either the first close outside naming a side or where the
 * session is — the range forming, the watch on, or the next open.
 *
 * One signal a session, three sessions a day: the quiet screen is the one
 * nearly every visit sees, so it must say when to come back.
 */
test('Open Range says where the session is and keeps both keys', async ({ page, context }) => {
  await asReturningUser(page, context);
  await page.goto('/orb');

  await expect(page.getByText(/^Open Range( · [A-Z]+)?$/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('signal-chart')).toBeVisible();

  // The legend names the session by its open, on the user's clock, and its phase.
  const legend = page.getByTestId('chart-legend');
  await expect(legend).toContainText(/^Open \d\d:\d\d · 1m · /, { timeout: 30_000 });
  await expect(legend).toContainText(/range forming · until \d\d:\d\d|range [\d.]+ – [\d.]+ · until \d\d:\d\d|closed (above|below) \d\d:\d\d|broke (up|down) \d\d:\d\d · next \d\d:\d\d|next open \d\d:\d\d/);

  const lit = page.getByTestId('signal-lit');
  if (await lit.isVisible().catch(() => false)) {
    await expect(lit).toHaveText(/SIGNAL · (UP|DOWN)/);
    await expect(lit).toContainText(/closed (above|below) the \d\d:\d\d range (high|low)/);
  } else {
    const waiting = page.getByTestId('signal-waiting');
    await expect(waiting).toContainText('No signal now');
    await expect(waiting).toContainText(/range|broke (up|down)|next open|warming up/);
  }

  await expect(page.getByTestId('key-up')).toBeVisible();
  await expect(page.getByTestId('key-down')).toBeVisible();
});
