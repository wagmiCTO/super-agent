import { expect, test } from '@playwright/test';

import { openExchangeAccount, skipOnboarding } from './onboarded';

/**
 * The account layer meets the venue: a passkey wallet derives the Direction
 * strategy's key, signs the venue's EIP-712 enrollment document for it, the
 * platform proves possession, and the venue issues it bound to our builder
 * code. From then on the wallet's requests are signed by its request key.
 *
 * This is a real enrollment on testnet — the venue keeps the key until the
 * wallet revokes it — so it runs behind npm run e2e like the trading tests.
 *
 * The screens do the enrolling: the activation screen is where a wallet's
 * key is born, and the assertions below are about what that left behind,
 * which is not something a screen shows.
 */

/** Where the platform answers; the app's own default in a local run. */
const API = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080').replace(/\/$/, '');

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

  await skipOnboarding(page);
  await page.goto('/');
  await page.getByTestId('passkey-create').click();
  await openExchangeAccount(page);
  await expect(page.getByTestId('strategy-direction')).toBeVisible({ timeout: 60_000 });

  const address = await page.evaluate(() => (JSON.parse(window.localStorage.getItem('tradeagent.account') ?? '{}') as { address?: string }).address);
  expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);

  // The key is known to the platform for this address and strategy only, and
  // it is bound to our builder code — which cannot be attached after the
  // fact, so a key born without it never earns us anything.
  const res = await page.request.get(`${API}/v1/exchange/key?address=${address}&strategy=direction`);
  expect(res.status()).toBe(200);
  const key = await res.json();
  expect(key.builder_id).toBe(18);
  expect(key.max_builder_fee_per_100k).toBe(50);
  expect(key.strategy).toBe('direction');
  expect(key.derived).toBe(true);
  expect((await page.request.get(`${API}/v1/exchange/key?address=${address}&strategy=rsi`)).status()).toBe(404);

  // The wallet registered its request-signing key on unlock, so a bare
  // request by address is refused now; the app's own requests are signed.
  const unsigned = await page.request.get(`${API}/v1/state?strategy=direction`, { headers: { 'X-Account-Address': address! } });
  expect(unsigned.status()).toBe(401);

  // And the account the activation opened is this wallet's own: funded by
  // the venue on first contact, and trading.
  const state = (await page.evaluate(async () => {
    const mod = (window as unknown as { __tradeagent?: { state: (s: string) => Promise<unknown> } }).__tradeagent;
    if (!mod) throw new Error('test hook missing');
    return mod.state('direction');
  })) as { account: { id: string; status: string; balance: string } };
  expect(state.account.status).toBe('active');
  expect(state.account.id).not.toBe('0');
  expect(Number(state.account.balance)).toBeGreaterThanOrEqual(100);

  // A real fill through that key, then flat again.
  await page.getByTestId('strategy-direction').click({ force: true });
  await page.getByTestId('key-up').last().click({ timeout: 30_000 });
  await expect(page.getByTestId('notice').last()).toHaveText(/^Filled/, { timeout: 40_000 });
  await page.getByTestId('close-position').last().click();
  await expect(page.getByTestId('notice').last()).toHaveText(/^Closed/, { timeout: 40_000 });
});
