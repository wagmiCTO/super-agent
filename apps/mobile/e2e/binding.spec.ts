import { expect, test } from '@playwright/test';

import { asReturningUser } from './onboarded';

/**
 * A position belongs to the strategy whose tap opened it, and the screen
 * says so wherever the user goes: the strategy that opened it shows it,
 * on every visit and after a reload; the others offer that market greyed
 * out, by the holder's name, and keep their own keys.
 *
 * Opens a real position on testnet and closes it at the end.
 */
test('a position stays with the strategy that opened it, and the others grey its market out', async ({ page, context }, info) => {
  await asReturningUser(page, context);

  await page.goto('/direction');
  const up = page.getByTestId('key-up');
  const close = page.getByTestId('close-position');
  await expect(up.or(close)).toBeVisible({ timeout: 30_000 });
  if (await close.isVisible()) {
    await close.click();
    await expect(up).toBeVisible({ timeout: 40_000 });
  }

  // The market is a key with a chevron; the menu names every market.
  const picker = page.getByTestId('symbol-picker');
  await expect(picker).toContainText('MON');
  await picker.click();
  await expect(page.getByTestId('symbol-menu')).toBeVisible();
  await expect(page.getByTestId('symbol-MON')).toContainText('✓');
  await expect(page.getByTestId('symbol-ZEC')).toBeInViewport();
  await page.screenshot({ path: info.outputPath('direction-menu.png') });
  await picker.click();

  await up.click();
  await expect(page.getByTestId('open-position')).toContainText(/^Up/, { timeout: 40_000 });

  // Another strategy: its own keys, and MON on offer only as Direction's.
  await page.goto('/ma-cross');
  await expect(page.getByTestId('key-up')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('open-position')).toHaveCount(0);
  await page.getByTestId('symbol-picker').click();
  const mon = page.getByTestId('symbol-MON');
  await expect(mon).toContainText('in Direction');
  // Greyed out means a press does nothing: the menu stays open on ETH.
  await mon.click({ force: true });
  await expect(page.getByTestId('symbol-menu')).toBeVisible();
  await expect(page.getByTestId('symbol-picker')).not.toContainText('MON');
  await page.screenshot({ path: info.outputPath('ma-cross-menu.png') });

  // The RSI screen, with the thermometer and its own keys.
  await page.goto('/rsi');
  await expect(page.getByTestId('key-up')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('rsi-thermometer')).toBeVisible();
  // The pane has drawn once the price is on it.
  await expect(page.getByTestId('chart-price')).toHaveText(/\d/, { timeout: 30_000 });
  await page.screenshot({ path: info.outputPath('rsi.png') });

  // Back to Direction, and after a reload: the position is still its own.
  await page.goto('/direction');
  await expect(page.getByTestId('open-position')).toContainText(/^Up/, { timeout: 30_000 });
  await page.reload();
  await expect(page.getByTestId('open-position')).toContainText(/^Up/, { timeout: 30_000 });
  await page.screenshot({ path: info.outputPath('direction-position.png') });

  await page.getByTestId('close-position').click();
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 40_000 });
});
