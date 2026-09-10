import { expect, test } from '@playwright/test';

/**
 * The account layer meets the venue: a passkey wallet derives the Direction
 * strategy's key, signs the venue's EIP-712 enrollment document for it, the
 * platform proves possession, and the venue issues it bound to our builder
 * code. From then on the wallet's requests are signed by its request key.
 *
 * This is a real enrollment on testnet — the venue keeps the key until the
 * wallet revokes it — so it runs behind npm run e2e like the trading tests.
 */
test('a passkey wallet enables a strategy with its own derived key', async ({ page, context }) => {
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

  // A fresh wallet has no key for the strategy; the screen offers to enable it.
  await expect(page.getByTestId('enabled-strategies')).toHaveText(/No strategy keys yet/);
  const enable = page.getByTestId('strategy-key').getByRole('button', { name: 'Enable Direction', exact: true });
  await expect(enable).toBeVisible();
  await enable.click();

  // The wallet signed, the platform enrolled, the venue answered with terms.
  await expect(page.getByTestId('strategy-key-status')).toHaveText(/Direction key enrolled · builder 18 · fee up to 0\.050% · derived from your passkey/, {
    timeout: 45_000,
  });
  await expect(page.getByTestId('enabled-strategies')).toHaveText(/Keys: Direction/);

  // The key is now known to the platform for this address and strategy only.
  const res = await page.request.get(`http://localhost:8080/v1/exchange/key?address=${address}&strategy=direction`);
  expect(res.status()).toBe(200);
  const key = await res.json();
  expect(key.builder_id).toBe(18);
  expect(key.max_builder_fee_per_100k).toBe(50);
  expect(key.strategy).toBe('direction');
  expect(key.derived).toBe(true);
  expect((await page.request.get(`http://localhost:8080/v1/exchange/key?address=${address}&strategy=rsi`)).status()).toBe(404);

  // The wallet registered its request-signing key on unlock, so a bare
  // request by address is refused now; the app's own requests are signed.
  const unsigned = await page.request.get('http://localhost:8080/v1/state?strategy=direction', { headers: { 'X-Account-Address': address! } });
  expect(unsigned.status()).toBe(401);

  // From now on the screen acts for this wallet, not the platform's own
  // account: a fresh wallet has no exchange account yet, and the screen says
  // what to do about it.
  await expect(page.getByTestId('account-status')).toHaveText(/not activated yet/, { timeout: 15_000 });
  const readState = () =>
    page.evaluate(async () => {
      const mod = (window as unknown as { __tradeagent?: { state: (s: string) => Promise<unknown> } }).__tradeagent;
      if (!mod) throw new Error('test hook missing');
      return mod.state('direction');
    }) as Promise<{ account: { id: string; status: string; balance: string }; positions: unknown[] }>;
  const body = await readState();
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
  const activated = await readState();
  expect(activated.account.status).toBe('active');
  expect(activated.account.id).not.toBe('0');
  expect(Number(activated.account.balance)).toBeGreaterThanOrEqual(100);

  // And the wallet trades through its own key: a real fill on testnet, then flat.
  await page.getByRole('button', { name: 'Amount 5', exact: true }).click();
  await page.getByRole('button', { name: 'Up', exact: true }).click();
  await expect(page.getByTestId('notice')).toHaveText(/Filled/, { timeout: 30_000 });
  const opened = await readState();
  expect(opened.positions).toHaveLength(1);
  await page.getByRole('button', { name: 'Close position', exact: true }).click();
  await expect(page.getByTestId('notice')).toHaveText(/Closed/, { timeout: 30_000 });
});
