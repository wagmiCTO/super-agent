import { expect, test } from '@playwright/test';

/**
 * Strategy #3 renders from the platform's live Box signal: the range, the
 * chart, and either a breakout window with a one-sided entry or the quiet
 * wait inside the box.
 */
test('Box screen shows the range and offers only the breakout side', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Play Box', exact: true }).click();
  await expect(page.getByText(/^BOX · MON$/)).toBeVisible();
  await expect(page.getByTestId('signal-box')).toHaveText(/^box [\d.]+ – [\d.]+ · 30×1m$/, { timeout: 20_000 });
  await expect(page.getByTestId('signal-chart')).toBeVisible();

  const window = page.getByTestId('signal-window');
  if (await window.isVisible()) {
    const text = await window.textContent();
    const side = text?.startsWith('Broke up') ? 'Up' : 'Down';
    const other = side === 'Up' ? 'Down' : 'Up';
    await expect(page.getByRole('button', { name: side, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: other, exact: true })).toHaveCount(0);
  } else {
    await expect(page.getByTestId('signal-waiting')).toHaveText(/Inside the box/);
    await expect(page.getByRole('button', { name: 'Up', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Down', exact: true })).toHaveCount(0);
  }
});
