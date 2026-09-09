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
  // Three on-chain transactions and a socket re-sign-in sit inside this test.
  test.setTimeout(300_000);
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

  await page.goto('/direction');
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

  // From now on the screen acts for this wallet, not the platform's own
  // account: a fresh wallet has no exchange account yet, and the screen says
  // what to do about it.
  await expect(page.getByTestId('account-status')).toHaveText(/not activated yet/, { timeout: 15_000 });
  const state = await page.request.get('http://localhost:8080/v1/state', {
    headers: { 'X-Account-Address': address! },
  });
  expect(state.status()).toBe(200);
  const body = await state.json();
  expect(body.account.id).toBe('0');
  expect(body.account.status).toBe('no_exchange_account');

  // The activation card reads the wallet's balances from the chain. Perpl's
  // testnet funds every new profile on sign-in (1 MON, 10000 AUSD), so the
  // wallet is already able to pay for its own activation.
  const card = page.getByTestId('activation');
  await expect(card).toBeVisible();
  await expect(page.getByTestId('activation-funding')).toHaveText(/AUSD 10000 of 100 · MON 1 for gas/, { timeout: 20_000 });
  const activateButton = card.getByRole('button', { name: 'Activate', exact: true });
  await expect(activateButton).toBeEnabled();

  // Three transactions from the wallet, each waited for; the platform sees
  // the new account on its trading socket and the screen switches to trading.
  await activateButton.click();
  await expect(page.getByTestId('activation-progress')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('account-status')).toBeHidden({ timeout: 180_000 });
  const activated = await (
    await page.request.get('http://localhost:8080/v1/state', { headers: { 'X-Account-Address': address! } })
  ).json();
  expect(activated.account.status).toBe('active');
  expect(activated.account.id).not.toBe('0');
  expect(Number(activated.account.balance)).toBeGreaterThanOrEqual(100);

  // And the wallet trades through its own key: a real fill on testnet, then flat.
  await page.getByRole('button', { name: 'Amount 5', exact: true }).click();
  await page.getByRole('button', { name: 'Up', exact: true }).click();
  await expect(page.getByTestId('notice')).toHaveText(/Filled/, { timeout: 30_000 });
  const opened = await (
    await page.request.get('http://localhost:8080/v1/state', { headers: { 'X-Account-Address': address! } })
  ).json();
  expect(opened.positions).toHaveLength(1);
  await page.getByRole('button', { name: 'Close position', exact: true }).click();
  await expect(page.getByTestId('notice')).toHaveText(/Closed/, { timeout: 30_000 });
});
