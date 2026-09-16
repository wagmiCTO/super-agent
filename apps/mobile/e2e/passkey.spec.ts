import { expect, test } from '@playwright/test';

import { skipOnboarding } from './onboarded';

/**
 * The account layer, end to end, with a virtual authenticator that supports
 * the PRF extension — the same ceremony a real passkey provider runs, minus
 * the biometric prompt.
 *
 * What is asserted: a passkey yields an address, signing out forgets it, and
 * signing back in with the same passkey reproduces the same address. That
 * last one is the whole point of deriving accounts from PRF output — lose it
 * and every returning user is a stranger with an empty account.
 *
 * Nothing here opens an exchange account: this is about the key, and the
 * venue is not involved in deriving one.
 */
test.describe('Passkey account', () => {
  /** What the app remembers about the account, as it stores it. */
  const stored = (page: import('@playwright/test').Page) =>
    page.evaluate(() => {
      const raw = window.localStorage.getItem('tradeagent.account');
      return raw ? (JSON.parse(raw) as { address: string }) : null;
    });

  test('create, sign out, sign back in to the same address', async ({ page, context }) => {
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
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

    // A device with no account is asked for one, and told what it is.
    await expect(page.getByText('Your account is a passkey')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('passkey-create').click();
    await page.waitForURL((url) => !url.pathname.includes('passkey'), { timeout: 30_000 });

    const first = await stored(page);
    expect(first?.address).toMatch(/^0x[0-9a-fA-F]{40}$/);

    // The passkey lives in the authenticator; the app keeps the credential
    // id and the address, and nothing that could rebuild the key on its own.
    const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
    expect(credentials).toHaveLength(1);
    expect(credentials[0].isResidentCredential).toBe(true);

    // Signing out forgets the account on this device.
    await page.goto('/account');
    await expect(page.getByTestId('wallet-address')).toHaveText(/^0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}$/, { timeout: 20_000 });
    await page.getByTestId('sign-out').click();
    await expect(page.getByText('Your account is a passkey')).toBeVisible({ timeout: 20_000 });
    expect(await stored(page)).toBeNull();

    // And the same passkey brings back the same address: the key is derived
    // from the PRF output, not stored anywhere to be lost.
    await page.getByTestId('passkey-signin').click();
    await page.waitForURL((url) => !url.pathname.includes('passkey'), { timeout: 30_000 });
    expect((await stored(page))?.address).toBe(first?.address);
  });
});
