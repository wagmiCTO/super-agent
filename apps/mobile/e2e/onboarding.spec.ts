import { expect, test } from '@playwright/test';

/**
 * The first visit: pick a network, read three slides, arrive at the passkey.
 *
 * Deliberately does not seed anything — a cold, empty browser is exactly the
 * state this flow exists for. Nothing here is a gate: Skip leaves at any
 * point, and the promo never shows twice.
 */
test('a first visit runs from the network choice to the passkey', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('How do you want to start?')).toBeVisible();
  await expect(page.getByTestId('network-mainnet')).toBeVisible();
  await page.getByTestId('network-testnet').click();

  await expect(page.getByText('Be the smartest one in the market')).toBeVisible();
  await page.getByTestId('intro-next').click();
  await expect(page.getByText('Your trading copilot')).toBeVisible();
  await page.getByTestId('intro-next').click();
  await expect(page.getByText('This is where you get good')).toBeVisible();
  await page.getByTestId('intro-next').click();

  await expect(page.getByText('Your account is a passkey')).toBeVisible();
  await expect(page.getByTestId('passkey-create')).toBeVisible();
});

test('the promo does not come back on the next visit', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('network-testnet').click();
  await expect(page.getByText('Be the smartest one in the market')).toBeVisible();
  await page.getByTestId('intro-skip').click();
  await expect(page.getByText('Your account is a passkey')).toBeVisible();

  // A reload is the cheapest cold start: the visit resumes where it was.
  await page.reload();
  await expect(page.getByText('Your account is a passkey')).toBeVisible();
  await expect(page.getByText('How do you want to start?')).toHaveCount(0);
});
