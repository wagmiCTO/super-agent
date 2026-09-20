/**
 * The locked account, which is what a second visit in a normal browser is.
 *
 * The seed lives in the tab's sessionStorage and the address in localStorage,
 * so a browser that is not incognito comes back with an account on the device
 * and no key for it. Every request then goes out for nobody and the platform
 * answers "sign in" — which the header said, in a chip that was not a button,
 * on a screen with no way to sign in on it. The passkey screen was no help:
 * it counted a remembered account as signed in and handed it straight back.
 *
 * Unlike the rest of the suite this needs no platform: the two refusals that
 * lock a screen are stubbed, because what is under test is the way out of
 * them, not what causes them.
 */
import { expect, test, type Page } from '@playwright/test';

const ACCOUNT = {
  credential: { credentialId: 'ZmFrZQ', transports: ['internal'] },
  address: '0x1111111111111111111111111111111111111111',
  label: 'Tap Trader account',
};

/** A returning visitor, optionally with an account remembered and locked. */
async function seed(page: Page, account: typeof ACCOUNT | null, wipeSession = true): Promise<void> {
  await page.addInitScript(
    ([a, wipe]) => {
      window.localStorage.setItem(
        'tradeagent.onboarding',
        JSON.stringify({ network: 'testnet', introSeen: true, lessonSeen: true, taught: ['direction', 'ma-cross', 'rsi'] }),
      );
      window.localStorage.setItem('tradeagent.analysis', JSON.stringify({ day: new Date().toISOString().slice(0, 10) }));
      if (a) window.localStorage.setItem('tradeagent.account', JSON.stringify(a));
      // The unlocked session is the tab's, and this script runs on every
      // navigation: clearing it here is the locked state, held for the test.
      if (wipe) window.sessionStorage.clear();
    },
    [account, wipeSession] as const,
  );
}

/** The platform, refusing everything the same way. */
async function refusing(page: Page, error: 'own_account_disabled' | 'no_key'): Promise<void> {
  const body = JSON.stringify({ error, message: 'refused' });
  await page.route('**/v1/markets*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/v1/**', (r) => r.fulfill({ status: 403, contentType: 'application/json', body }));
}

test('a remembered account can sign in from the lobby and from a strategy', async ({ page }) => {
  await seed(page, ACCOUNT);
  await refusing(page, 'own_account_disabled');

  await page.goto('/');
  await expect(page.getByText('Choose a strategy')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('sign-in-badge').click();
  await expect(page.getByText('Welcome back')).toBeVisible({ timeout: 20_000 });

  await page.goto('/direction');
  await page.getByTestId('sign-in-badge').click({ timeout: 30_000 });
  await expect(page.getByText('Welcome back')).toBeVisible({ timeout: 20_000 });
});

test('a signed-in wallet with no exchange key is sent to open the account', async ({ page, context }) => {
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
  await seed(page, null, false);
  await refusing(page, 'no_key');

  await page.goto('/');
  await page.getByTestId('passkey-create').click({ timeout: 30_000 });
  // The gate sends a keyless wallet to activation. The strategy screen is
  // still reachable by its own URL, and there the badge is that same errand.
  await expect(page.getByText('Open your account')).toBeVisible({ timeout: 40_000 });

  await page.goto('/direction');
  await page.getByTestId('open-account-badge').click({ timeout: 30_000 });
  await expect(page.getByText('Open your account')).toBeVisible({ timeout: 20_000 });
});

/**
 * The whole way out, with a real passkey: the one path the fix opened.
 *
 * The account is created, the session is thrown away the way closing the tab
 * throws it away, and the badge in the lobby has to lead all the way back to
 * an unlocked wallet — the same address, derived again from the passkey and
 * never stored.
 */
test('the sign-in badge unlocks the account it remembers', async ({ page, context }) => {
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
  await seed(page, null, false);
  await refusing(page, 'own_account_disabled');

  await page.goto('/');
  await page.getByTestId('passkey-create').click({ timeout: 30_000 });
  await page.waitForURL((url) => !url.pathname.includes('passkey'), { timeout: 30_000 });
  const address = await page.evaluate(() => JSON.parse(window.localStorage.getItem('tradeagent.account') ?? 'null')?.address);
  expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);

  // Closing the tab, as far as the app can tell.
  await page.evaluate(() => window.sessionStorage.clear());
  await page.goto('/');
  await expect(page.getByTestId('sign-in-badge')).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('sign-in-badge').click();
  await page.getByTestId('passkey-signin-primary').click({ timeout: 20_000 });

  // Back to an unlocked wallet: the same address, and a session to sign with.
  await page.waitForURL((url) => !url.pathname.includes('passkey'), { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => Boolean(window.sessionStorage.getItem('tradeagent.session'))), { timeout: 20_000 }).toBe(true);
  expect(await page.evaluate(() => JSON.parse(window.localStorage.getItem('tradeagent.account') ?? 'null')?.address)).toBe(address);
  await expect(page.getByTestId('sign-in-badge')).toHaveCount(0);
});
