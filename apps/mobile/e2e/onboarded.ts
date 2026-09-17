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

import { expect, type BrowserContext, type Page } from '@playwright/test';

const KEY = 'tradeagent.onboarding';
/** The day's analysis sheet, shown once a day on a strategy screen; a returning user has seen today's. */
const ANALYSIS_KEY = 'tradeagent.analysis';

/** Call before `page.goto('/')` in any spec that wants the app, not the promo. */
export async function skipOnboarding(page: Page, network: 'testnet' | 'mainnet' = 'testnet'): Promise<void> {
  await page.addInitScript(
    ([key, value, analysisKey, analysisValue]) => {
      try {
        window.localStorage.setItem(key, value);
        window.localStorage.setItem(analysisKey, analysisValue);
      } catch {
        // Blocked storage: the spec will land on the promo and say so loudly.
      }
    },
    // Taught, too: a returning user has met the strategies, and the lobby
    // sends anyone who has not to the lesson first — which is correct, and
    // not what a spec about the app is asking about. And today's analysis
    // sheet has been read, so it does not sit over the keys.
    [KEY, JSON.stringify({ network, introSeen: true, lessonSeen: true, taught: ['direction', 'ma-cross', 'rsi'] }), ANALYSIS_KEY, JSON.stringify({ day: new Date().toISOString().slice(0, 10) })] as const,
  );
}

/**
 * A returning user: the promo behind them and a passkey on the device.
 *
 * Every spec that calls this mints a fresh wallet and opens a real account on
 * Perpl testnet, so a long run trips the venue's edge rate limit (HTTP 429,
 * Cloudflare 1015 on `/v1/auth/payload`) and the later specs fail on
 * activation rather than on anything they are testing. Run a file at a time,
 * or leave a minute between runs.
 *
 * The lobby is only reachable with an account — that is the point of the
 * onboarding — so a spec about the app has to arrive with one. The virtual
 * authenticator runs the same ceremony a real provider does, minus the
 * biometric prompt.
 *
 * Leaves the page on the lobby, activation included: see
 * `openExchangeAccount` below for why that is part of arriving.
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
  // A fresh wallet is not yet a trading account, and the gate routes it
  // through activation before the lobby — so arriving means going through it.
  await openExchangeAccount(page);
}

/**
 * The account, opened at the exchange.
 *
 * A wallet is not yet a trading account: the venue wants a strategy key, its
 * testnet funding and three transactions before an order is allowed. The
 * design gives that its own screen and one press, and the gate routes every
 * fresh wallet through it — so a spec that walks the first visit has to walk
 * this too. The work is on-chain, hence the patience.
 */
export async function openExchangeAccount(page: Page): Promise<void> {
  const start = page.getByTestId('enable-start');
  const lobby = page.getByText('Choose a strategy');

  // Wait for whichever the gate decides on. Waiting for the button alone and
  // giving up quietly is worse than useless: a slow platform then looks
  // exactly like an account that needed nothing, and the spec fails later,
  // somewhere else, on a splash screen.
  await expect(start.or(lobby)).toBeVisible({ timeout: 60_000 });
  if (!(await start.isVisible())) return;

  await start.click();
  await page.waitForURL((url) => !url.pathname.includes('enable'), { timeout: 120_000 });
  await expect(lobby).toBeVisible({ timeout: 30_000 });
}

/**
 * Scrolls the screen's own list to the end.
 *
 * A wheel event at the mouse's resting corner does not move a React Native
 * Web ScrollView — it is a div with its own overflow, not the document — so
 * a spec that waits for the next page after one waits for ever. This scrolls
 * the container itself, which is what a thumb does.
 */
export async function toBottom(page: Page): Promise<void> {
  await page.evaluate(() => {
    const list = [...document.querySelectorAll('div')].find(
      (d) => d.scrollHeight > d.clientHeight + 50 && getComputedStyle(d).overflowY !== 'visible',
    );
    if (list) list.scrollTop = list.scrollHeight;
  });
}
