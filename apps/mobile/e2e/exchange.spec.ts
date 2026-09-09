import { expect, test } from '@playwright/test';

/**
 * The account layer meets the venue: a passkey wallet signs the venue's
 * EIP-712 enrollment document, the platform proves it holds the new API key,
 * and the venue issues it bound to our builder code.
 *
 * This is a real enrollment on testnet — the venue keeps the key until the
 * wallet revokes it — so it runs behind npm run e2e like the trading tests.
 */
test('a passkey wallet enrolls an exchange key bound to the builder code', async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true,
      automaticPresenceSimulation: true,
    },
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByText('Signed in with passkey')).toBeVisible();
  const address = await page.getByTestId('account-address').textContent();

  // A fresh wallet has no key; the platform says so and offers to connect.
  const connect = page.getByRole('button', { name: 'Connect exchange', exact: true });
  await expect(connect).toBeVisible();
  await connect.click();

  // The wallet signed, the platform enrolled, the venue answered with terms.
  await expect(page.getByTestId('exchange-status')).toHaveText(/Exchange connected · builder 18 · fee up to 0\.050%/, { timeout: 45_000 });

  // The key is now known to the platform for this address.
  const res = await page.request.get(`http://localhost:8080/v1/exchange/key?address=${address}`);
  expect(res.status()).toBe(200);
  const key = await res.json();
  expect(key.builder_id).toBe(18);
  expect(key.max_builder_fee_per_100k).toBe(50);
});
