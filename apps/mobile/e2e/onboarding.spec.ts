import { expect, test } from '@playwright/test';

/**
 * The first visit, end to end: an empty browser, three slides, a passkey, one
 * lesson, and the screen where the first tap happens.
 *
 * The activation screen does not appear on testnet, and that is correct: Perpl
 * creates and funds a profile on first contact, so `/v1/state` comes back
 * `active` and there is nothing to approve. Its three transactions are a
 * mainnet concern, and the gate skips the screen when the exchange says the
 * account is ready.
 *
 * Deliberately seeds nothing — a cold browser is the state this flow exists
 * for. The virtual authenticator runs the same ceremony a real passkey
 * provider does, minus the biometric prompt.
 *
 * Nothing in the promo or the lesson is a gate: every step can be skipped, and
 * this asserts that too.
 */

async function withPasskey(page: import('@playwright/test').Page, context: import('@playwright/test').BrowserContext) {
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
}

test('a first visit runs from the promo to the first tap', async ({ page, context }) => {
  await withPasskey(page, context);
  await page.goto('/');

  // A3 — three slides, each with its own artwork.
  await expect(page.getByText('Be the smartest one in the market')).toBeVisible();
  await page.getByTestId('intro-next').click();
  await expect(page.getByText('Your trading copilot')).toBeVisible();
  await page.getByTestId('intro-next').click();
  await expect(page.getByText('This is where you get good')).toBeVisible();
  await page.getByTestId('intro-next').click();

  // A4 — the account is a passkey.
  await expect(page.getByText('Your account is a passkey')).toBeVisible();
  await page.getByTestId('passkey-create').click();

  // A7 — the first strategy. The exchange account is already active on
  // testnet, so the visit goes straight from the passkey to the lesson.
  await expect(page.getByText('Fifteen minutes. One call.')).toBeVisible({ timeout: 60_000 });
  for (let step = 0; step < 4; step++) await page.getByTestId('lesson-next').click();
  await expect(page.getByText('Ready')).toBeVisible();
  await page.getByTestId('lesson-next').click();

  await expect(page.getByRole('button', { name: 'Up', exact: true })).toBeVisible({ timeout: 30_000 });
});

test('every step of the first visit can be skipped', async ({ page, context }) => {
  await withPasskey(page, context);
  await page.goto('/');

  await page.getByTestId('intro-skip').click();
  await expect(page.getByText('Your account is a passkey')).toBeVisible();

  // A reload is the cheapest cold start: the visit resumes where it was
  // instead of replaying the promo.
  await page.reload();
  await expect(page.getByText('Your account is a passkey')).toBeVisible();
  await expect(page.getByText('Be the smartest one in the market')).toHaveCount(0);

  await page.getByTestId('passkey-create').click();
  await expect(page.getByText('Fifteen minutes. One call.')).toBeVisible({ timeout: 60_000 });

  // The lesson is not a gate either.
  await page.getByTestId('lesson-skip').click();
  await expect(page.getByRole('button', { name: 'Up', exact: true })).toBeVisible({ timeout: 30_000 });
});

/**
 * The splash is a decision, not a wait.
 *
 * A deployment with no platform behind it is a real situation — inflight.work
 * was exactly that — and the gate used to hold the splash for ever waiting for
 * an exchange state that was never coming. The first visit has to run whether
 * or not anything answers.
 */
test('the first visit runs with no platform reachable', async ({ page, context }) => {
  await withPasskey(page, context);
  await page.route('**/localhost:8080/**', (route) => route.abort());

  await page.goto('/');
  await expect(page.getByText('Be the smartest one in the market')).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('intro-skip').click();
  await page.getByTestId('passkey-create').click();

  // Without an answer the gate must not guess that the account is unopened,
  // so the activation screen stays away and the lesson comes next.
  await expect(page.getByText('Fifteen minutes. One call.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Open your account')).toHaveCount(0);
});
