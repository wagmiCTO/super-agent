import { expect, test } from '@playwright/test';

/**
 * Strategy #3 renders from the platform's live RSI signal: the thermometer,
 * the chart, and either a zone window with a one-sided entry or the wait.
 */
test('RSI screen shows the index and offers only the zone side', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Play RSI Bounce', exact: true }).click();
  await expect(page.getByText(/^RSI BOUNCE · MON$/)).toBeVisible();
  await expect(page.getByTestId('signal-rsi')).toHaveText(/^RSI\(14\) · 1m · zones 30 \/ 70$/, { timeout: 20_000 });
  await expect(page.getByTestId('rsi-value')).toHaveText(/^\d{1,3}$/);
  await expect(page.getByTestId('signal-chart')).toBeVisible();

  const window = page.getByTestId('signal-window');
  if (await window.isVisible()) {
    const text = await window.textContent();
    const side = text?.startsWith('Oversold') ? 'Up' : 'Down';
    const other = side === 'Up' ? 'Down' : 'Up';
    await expect(page.getByRole('button', { name: side, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: other, exact: true })).toHaveCount(0);
  } else {
    await expect(page.getByTestId('signal-waiting')).toHaveText(/Waiting for the crowd/);
    await expect(page.getByRole('button', { name: 'Up', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Down', exact: true })).toHaveCount(0);
  }
});
