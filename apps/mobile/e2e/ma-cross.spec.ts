import { expect, test } from '@playwright/test';

import { asReturningUser } from './onboarded';

/**
 * Strategy #2 renders from the platform's live signal: the chart, and either
 * a lit window naming a side or the wait for the next cross. A cross cannot
 * be forced on testnet, so the entry itself is exercised by the Direction
 * tests through the same trading hook.
 *
 * The design's rule about the keys is what this spec is really for: they are
 * always both present and never change size or place. A signal fills the side
 * it names and leaves the other an outline; with no signal both are outlines.
 * A screen whose buttons appear and disappear moves under a finger that is
 * already on the way.
 */
test('MA Cross shows the live signal and keeps both keys', async ({ page, context }) => {
  await asReturningUser(page, context);
  await page.goto('/ma-cross');

  await expect(page.getByText('MA Cross', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('signal-chart')).toBeVisible();

  const lit = page.getByTestId('signal-lit');
  if (await lit.isVisible().catch(() => false)) {
    await expect(lit).toHaveText(/SIGNAL · (UP|DOWN)/);
    // The window is a deadline, and the screen counts down to it.
    await expect(lit).toContainText('window');
  } else {
    await expect(page.getByTestId('signal-waiting')).toContainText('No signal now');
  }

  // Both keys, signal or no signal.
  await expect(page.getByTestId('key-up')).toBeVisible();
  await expect(page.getByTestId('key-down')).toBeVisible();

  // What a tap would open is on the screen before it is pressed.
  await expect(page.getByTestId('settings-chip')).toContainText('AUSD');

  await page.getByTestId('lobby-link').click();
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
});
