import { expect, test } from '@playwright/test';

/**
 * Any-chain deposits over Aurora Intents: the screen lists what can be
 * sent from which chain, and a quote for a signed-in wallet reaches Aurora
 * — which, below its current minimum, refuses in its own words. No deposit
 * address is reserved by this test.
 */
test('the deposit screen lists origins and relays Aurora’s answer', async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true },
  });

  await page.goto('/');
  await page.getByTestId('deposit-link').click();
  await expect(page.getByTestId('deposit')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Arrives as USDC on Monad/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Chain base', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Asset USDC', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByText('Signed in with passkey')).toBeVisible();

  await page.getByLabel('Amount').fill('10');
  await page.getByRole('button', { name: 'Get deposit address', exact: true }).click();
  await expect(page.getByTestId('notice')).toHaveText(/minimum swap amount/i, { timeout: 30_000 });
});
