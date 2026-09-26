import { expect, test } from '@playwright/test';

import { asReturningUser } from './onboarded';

/**
 * Strategy #4 renders from the platform's live channel signal: the chart
 * with the Donchian channel drawn over the bars, and either a breakout
 * naming a side or the wait inside the channel.
 *
 * A breakout cannot be forced on testnet, so what is asserted is the quiet
 * screen most visits see: it says which channel it is watching and where
 * its edges are, rather than looking broken.
 */
test('Turtles shows the channel and keeps both keys', async ({ page, context }) => {
  await asReturningUser(page, context);
  await page.goto('/donchian');

  await expect(page.getByText(/^Turtles( · [A-Z]+)?$/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('signal-chart')).toBeVisible();

  // The legend names the channel and, once the platform has read the bars,
  // its two edges or the break.
  const legend = page.getByTestId('chart-legend');
  await expect(legend).toContainText(/^Channel 20 · 1m · /);
  await expect(legend).toContainText(/closed (above|below) \d\d:\d\d|[\d.]+ – [\d.]+/, { timeout: 30_000 });

  const lit = page.getByTestId('signal-lit');
  if (await lit.isVisible().catch(() => false)) {
    await expect(lit).toHaveText(/SIGNAL · (UP|DOWN)/);
    await expect(lit).toContainText(/closed (above|below) the 20-bar (high|low)/);
  } else {
    const waiting = page.getByTestId('signal-waiting');
    await expect(waiting).toContainText('No signal now');
    await expect(waiting).toContainText(/inside the channel|warming up/);
  }

  await expect(page.getByTestId('key-up')).toBeVisible();
  await expect(page.getByTestId('key-down')).toBeVisible();
});
