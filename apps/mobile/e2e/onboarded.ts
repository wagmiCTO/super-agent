/**
 * Most specs are about the app, not about arriving at it.
 *
 * The entry point sends a first-time visitor through the promo, so a test that
 * goes to `/` and expects the lobby has to say it is not a first-time visitor.
 * This seeds the same preferences the onboarding writes, before any script on
 * the page runs.
 *
 * The onboarding itself is covered by `onboarding.spec.ts`, which deliberately
 * does not use this.
 */

import type { BrowserContext, Page } from '@playwright/test';

const KEY = 'tradeagent.onboarding';

/** Call before `page.goto('/')` in any spec that wants the app, not the promo. */
export async function skipOnboarding(page: Page, network: 'testnet' | 'mainnet' = 'testnet'): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // Blocked storage: the spec will land on the promo and say so loudly.
      }
    },
    [KEY, JSON.stringify({ network, introSeen: true })] as const,
  );
}

/**
 * A returning user: the promo behind them and a passkey on the device.
 *
 * The lobby is only reachable with an account — that is the point of the
 * onboarding — so a spec about the app has to arrive with one. The virtual
 * authenticator runs the same ceremony a real provider does, minus the
 * biometric prompt.
 *
 * Leaves the page on the lobby.
 */
export async function asReturningUser(page: Page, context: BrowserContext): Promise<void> {
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
  await page.waitForURL((url) => !url.pathname.includes('passkey'));
}
