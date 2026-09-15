import { expect, test } from '@playwright/test';

import { asReturningUser } from './onboarded';

/**
 * Any-chain deposits over Aurora Intents: the screen lists what can be
 * sent from which chain, and a quote for a signed-in wallet reaches Aurora
 * — which, below its current minimum, refuses in its own words. No deposit
 * address is reserved by this test.
 */
test('the deposit screen lists origins and relays Aurora’s answer', async ({ page, context }) => {
  // Arriving brings the virtual authenticator with it; Chrome allows one.
  await asReturningUser(page, context);
  // Add funds lives on the account screen, as the design has it.
  await page.getByTestId('account-link').click({ force: true });
  await page.getByTestId('deposit-link').click();
  await expect(page.getByTestId('deposit')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Arrives as USDC on Monad/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Chain base', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Asset USDC', exact: true })).toBeVisible();

  // Arriving signed the wallet in; the deposit screen says so.
  // The account stub stays mounted under the deposit screen in the stack.
  await expect(page.getByText('Signed in with passkey').last()).toBeVisible();

  await page.getByLabel('Amount').fill('10');
  await page.getByRole('button', { name: 'Get deposit address', exact: true }).click();
  await expect(page.getByTestId('notice')).toHaveText(/minimum swap amount/i, { timeout: 30_000 });
});
