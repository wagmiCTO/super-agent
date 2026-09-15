import { expect, test } from '@playwright/test';

import { asReturningUser } from './onboarded';

/**
 * Risk, end to end on testnet: a tap opens a position, the risk screen
 * shows it at stake in the arc, the ring and the list, the limits are the
 * safe tier as a share of the balance, the danger zone moves them and puts
 * them back, and "close everything" flattens the account and says what it
 * did.
 */
test('the risk screen shows the day, moves the limits, and closes everything', async ({ page, context }) => {
  await asReturningUser(page, context);

  // A tap, so there is something at stake.
  await page.getByTestId('strategy-direction').click({ force: true });
  await page.getByTestId('key-up').last().click({ timeout: 30_000 });
  await expect(page.getByTestId('notice').last()).toHaveText(/^Filled/, { timeout: 40_000 });

  await page.getByTestId('lobby-link').last().click();
  await page.getByTestId('risk-link').last().click({ force: true });
  await expect(page.getByTestId('risk-level')).toHaveText(/Warm|Hot/, { timeout: 20_000 });
  await expect(page.getByTestId('risk-sub')).toContainText(/1 trade open · [\d.]+ AUSD can still be lost right now/);
  await expect(page.getByTestId('risk-budget')).toContainText(/of \d+/);
  await expect(page.getByTestId('ring-direction')).toContainText(/\d+\.\d\d × \d+x/);
  const pos = page.getByTestId('risk-position').first();
  await expect(pos).toContainText(/Direction · Up/);
  await expect(pos).toContainText(/\d+\.\d\d × \d+x · (stop −\d+|no stop) · closes in \d+:\d\d/);

  // The safe tier, as money: 20% of the balance.
  const limits = page.getByTestId('risk-limits');
  await expect(limits).toContainText(/Daily loss\s*\d+ AUSD · 20% of balance/);
  await expect(limits).toContainText(/Open at once\s*2 positions/);
  await expect(limits).toContainText(/Cooldown between taps\s*10 s/);
  await expect(page.getByTestId('risk-week')).toBeVisible();
  await expect(page.getByTestId('risk-hours')).toBeVisible();

  // The danger zone: the budget slider to its end is the ceiling, which
  // takes a second tap; the platform then holds the wallet to it.
  const zone = page.getByTestId('danger-zone');
  await zone.scrollIntoViewIfNeeded();
  const track = await page.getByTestId('danger-daily-slider').boundingBox();
  if (!track) throw new Error('no slider');
  await page.mouse.click(track.x + track.width - 2, track.y + track.height / 2);
  await expect(page.getByTestId('danger-daily')).toHaveText('75% of balance');
  const apply = page.getByTestId('danger-apply');
  await apply.click();
  await expect(apply).toHaveText(/Tap again/);
  await apply.click();
  await expect(page.getByTestId('danger-notice')).toHaveText(/Applied/, { timeout: 20_000 });
  await expect(limits).toContainText(/75% of balance/, { timeout: 10_000 });

  // And back to the safe tier.
  await page.getByTestId('danger-reset').click();
  await expect(limits).toContainText(/20% of balance/, { timeout: 20_000 });

  // Close everything asks twice, then says what it did.
  const button = page.getByTestId('close-all');
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await expect(button).toHaveText(/Tap again to close everything · \d/);
  await button.click();
  await expect(page.getByTestId('closed-pnl')).toHaveText(/^[+−]?\d+\.\d\d$/, { timeout: 40_000 });
  await expect(page.getByTestId('closed')).toContainText(/1 position closed at market/);
  await page.getByTestId('closed-back').click();
  await expect(page.getByText('Choose a strategy').last()).toBeVisible({ timeout: 20_000 });
});
