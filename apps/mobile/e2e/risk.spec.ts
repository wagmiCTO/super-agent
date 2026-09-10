import { expect, test } from '@playwright/test';

/**
 * Risk, end to end on testnet: a tap with a stop says what it risks, the
 * position carries its stop, the risk screen shows it at risk with the
 * limits and the market's edge, and "close everything" flattens it.
 */
test('a stop is armed with the tap and the risk screen shows what is at risk', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/direction');
  await expect(page.getByText('No position')).toBeVisible();

  // The default stop is −50%: the tap risks half the collateral.
  await page.getByRole('button', { name: 'Amount 10', exact: true }).click();
  await expect(page.getByTestId('tap-risk')).toHaveText(/This tap risks up to 2\.5 \(stop at −50% of 5 collateral\)/);
  await page.getByRole('button', { name: 'Stop Off', exact: true }).click();
  await expect(page.getByTestId('tap-risk')).toHaveText(/risks up to 5 — the whole collateral, no stop/);
  await page.getByRole('button', { name: 'Stop −25%', exact: true }).click();
  await expect(page.getByTestId('tap-risk')).toHaveText(/risks up to 1\.25 \(stop at −25%/);

  await page.getByRole('button', { name: 'Up', exact: true }).click();
  await expect(page.getByTestId('notice')).toHaveText(/^Filled/, { timeout: 30_000 });
  await expect(page.getByTestId('position-footer')).toHaveText(/stop at -[\d.]+ · closes in/, { timeout: 10_000 });

  await page.goto('/risk');
  await expect(page.getByTestId('risk-totals')).toBeVisible({ timeout: 20_000 });
  const pos = page.getByTestId('risk-position').first();
  await expect(pos).toContainText(/Direction · Up .* @ .* · 2x/);
  await expect(pos).toContainText(/at risk [\d.]+ · stop at -[\d.]+ · closes in/);
  await expect(page.getByTestId('risk-direction')).toContainText(/Today's loss budget/);
  await expect(page.getByTestId('risk-market')).toContainText(/A minute moves [\d.]+ bps; a round trip costs [\d.]+ bps\. Edge [\d.]+×\./);

  // Close everything asks twice, then flattens.
  const button = page.getByTestId('close-all');
  await button.click();
  await expect(button).toHaveText(/Tap again/);
  await button.click();
  await expect(page.getByTestId('notice')).toHaveText(/Closed 1 position/, { timeout: 30_000 });
  await expect(page.getByText('Nothing open. Nothing at risk.')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('risk-totals').getByTestId('perf-today')).toContainText(/\d+ trades? · \d+% won/);
});
