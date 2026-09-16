import { expect, test } from '@playwright/test';

import { asReturningUser } from './onboarded';

/**
 * Any-chain deposits over Aurora Intents: the screen lists what can be sent
 * from which chain, and a quote for a signed-in wallet reaches Aurora and
 * comes back as an address to send to.
 *
 * It used to assert the refusal below Aurora's minimum, which was $1000 when
 * this was written and is not any more: the same $10 now gets a real quote.
 * So what is asserted is the answer, whichever it is — an address to send to,
 * or Aurora's own words for why not. The address it reserves is never used
 * and expires on its own.
 */
test('the deposit screen lists origins and relays Aurora’s answer', async ({ page, context }) => {
  // Arriving brings the virtual authenticator with it; Chrome allows one.
  await asReturningUser(page, context);
  // Add funds lives on the account screen, as the design has it.
  // The account screen hides adding and withdrawing on testnet: the route
  // bridges real USDC to Monad mainnet, which a practice balance cannot use.
  // The screen itself still answers, and that is what this is about.
  await expect(page.getByTestId('account-link').last()).toBeVisible({ timeout: 30_000 });
  await page.goto('/deposit');
  await expect(page.getByTestId('deposit')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Arrives as USDC on Monad/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Chain base', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Asset USDC', exact: true })).toBeVisible();

  // Arriving signed the wallet in; the deposit screen says so.
  // The account stub stays mounted under the deposit screen in the stack.
  await expect(page.getByText('Signed in with passkey').last()).toBeVisible();

  await page.getByLabel('Amount').fill('10');
  await page.getByRole('button', { name: 'Get deposit address', exact: true }).click();

  // Either Aurora quotes the deposit — and then the screen says where to
  // send, on which chain, and what arrives — or it refuses in its own words.
  const quote = page.getByTestId('deposit-quote');
  const refusal = page.getByTestId('notice');
  await expect(quote.or(refusal)).toBeVisible({ timeout: 30_000 });
  if (await quote.isVisible()) {
    await expect(quote).toContainText(/Send 10(\.0)? USDC/);
    await expect(quote).toContainText(/you get [\d.]+ USDC/);
    await expect(page.getByTestId('deposit-address')).toHaveText(/^0x[0-9a-fA-F]{40}$/);
    await expect(page.getByTestId('deposit-status')).toContainText(/Waiting for your transfer/);
  } else {
    await expect(refusal).toHaveText(/minimum swap amount|deposit/i);
  }
});
