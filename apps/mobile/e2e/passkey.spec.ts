import { expect, test } from '@playwright/test';

/**
 * The account layer, end to end, with a virtual authenticator that supports
 * the PRF extension — the same ceremony a real passkey provider runs, minus
 * the biometric prompt.
 *
 * What is asserted: a passkey yields an address, signing out forgets it, and
 * signing back in with the same passkey reproduces the same address. That
 * last one is the whole point of deriving accounts from PRF output.
 */
test.describe('Passkey account', () => {
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

    await page.goto('/');
    await expect(page.getByText('No account')).toBeVisible();

    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByText('Signed in with passkey')).toBeVisible();
    const address = await page.getByTestId('account-address').textContent();
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);

    // The passkey now lives in the authenticator; the app remembers only the
    // credential id and the address.
    const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
    expect(credentials).toHaveLength(1);
    expect(credentials[0].isResidentCredential).toBe(true);

    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByText('No account')).toBeVisible();

    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText('Signed in with passkey')).toBeVisible();
    await expect(page.getByTestId('account-address')).toHaveText(address!);

    // A reload keeps the address on screen without a prompt, locked.
    await page.reload();
    await expect(page.getByText('Locked · passkey to unlock')).toBeVisible();
    await expect(page.getByTestId('account-address')).toHaveText(address!);
  });
});
