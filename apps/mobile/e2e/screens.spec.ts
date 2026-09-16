import { devices, expect, test, type Page } from '@playwright/test';

import { asReturningUser, skipOnboarding } from './onboarded';

/**
 * The three screens the lobby's footer leads to, on a real account: what the
 * wallet has done (History), what it holds (Account), and the link that
 * brings other people in (Invite).
 *
 * One account for all of it, and one tap, so the history has something in it
 * — every spec here opens a real Perpl testnet account, and the venue rate
 * limits how many may be opened from one machine in a row.
 */

/**
 * The lobby, from wherever the last assertion left the page. The screen on
 * top is the last one: a link back to the lobby pushes another copy of it
 * rather than popping, so the earlier ones are still in the tree, hidden.
 */
async function toLobby(page: Page) {
  await page.getByTestId('lobby-link').last().click({ force: true });
  await expect(page.getByText('Choose a strategy').last()).toBeVisible({ timeout: 20_000 });
}

test('history, account and the invite link, on one account', async ({ page, context }) => {
  await asReturningUser(page, context);
  await expect(page.getByText('Choose a strategy').last()).toBeVisible({ timeout: 30_000 });

  // --- History, before anything has happened.
  await page.getByTestId('history-link').last().click({ force: true });
  await expect(page.getByTestId('history-title').last()).toHaveText('History', { timeout: 20_000 });
  await expect(page.getByTestId('history-empty').last()).toContainText('No trades yet', { timeout: 20_000 });
  await expect(page.getByTestId('history-totals').last()).toContainText('0 trades');
  await toLobby(page);

  // --- One tap, so there is something to show.
  await page.getByTestId('strategy-direction').last().click({ force: true });
  await page.getByTestId('key-up').last().click({ timeout: 30_000 });
  await expect(page.getByTestId('notice').last()).toHaveText(/^Filled/, { timeout: 40_000 });
  await toLobby(page);

  // --- History, with a position open: it is on the list before it closes.
  await page.getByTestId('history-link').last().click({ force: true });
  const position = page.getByTestId('trade-row').last();
  await expect(position).toContainText(/Direction · Up @ [\d.]+/, { timeout: 20_000 });
  await expect(position).toContainText('open now');
  await expect(page.getByTestId('history-totals').last()).toContainText(/trade/);

  // The same round trip read as orders: the opening order, with its fee.
  await page.getByTestId('tab-orders').last().click();
  await expect(page.getByTestId('order-row').last()).toContainText(/Open Up · @ [\d.]+/);
  await expect(page.getByTestId('order-row').last()).toContainText(/fee \d+\.\d\d/);

  // A filter that has nothing in it says so rather than showing another
  // strategy's trades.
  await page.getByTestId('tab-positions').last().click();
  await page.getByTestId('filter-rsi').last().click();
  await expect(page.getByTestId('history-empty').last()).toBeVisible();
  await page.getByTestId('filter-direction').last().click();
  await expect(page.getByTestId('trade-row').last()).toBeVisible();
  await toLobby(page);

  // --- Account: the wallet, the money, and what the exchange calls it.
  await page.getByTestId('account-link').last().click({ force: true });
  await expect(page.getByTestId('account-title').last()).toHaveText('Account', { timeout: 20_000 });
  await expect(page.getByTestId('wallet-address').last()).toHaveText(/^0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}$/);
  await expect(page.getByTestId('wallet-card').last()).toContainText(/Balance\s*[\d.]+ AUSD/);
  await expect(page.getByTestId('wallet-card').last()).toContainText(/In open trades\s*[\d.]+ AUSD/);
  await expect(page.getByTestId('exchange-account').last()).toHaveText(/^Exchange account #\d+ · open$/, { timeout: 20_000 });
  // Mainnet is drawn but not open; the practice network is the one in force.
  await page.getByTestId('network-mainnet').last().click({ force: true });
  await expect(page.getByTestId('stub-title')).toHaveText('Mainnet', { timeout: 20_000 });
  await page.goBack();

  // --- Invite, reached from the account row as the design has it.
  await page.getByTestId('invite-row').last().click({ force: true });
  await expect(page.getByTestId('invite-title').last()).toHaveText('Invite friends', { timeout: 20_000 });
  const link = page.getByTestId('invite-link').last();
  await expect(link).toHaveText(/\/i\/[A-Z0-9]{6}$/, { timeout: 20_000 });
  await expect(page.getByTestId('invite-totals').last()).toContainText('invited');
  await expect(page.getByTestId('invite-empty').last()).toBeVisible();
  const invite = (await link.textContent())!.trim();

  // --- The link works: a friend on another device arrives on it, makes an
  // account of their own, and both sides say who brought whom.
  const friendContext = await context.browser()!.newContext({ ...devices['iPhone 15'], baseURL: 'http://localhost:8092' });
  const friend = await friendContext.newPage();
  const cdp = await friendContext.newCDPSession(friend);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true },
  });
  await skipOnboarding(friend);
  await friend.goto(`http://${invite}`);
  // The link keeps the code and steps out of the way: nothing to type.
  await friend.getByTestId('passkey-create').click({ timeout: 30_000 });
  await friend.waitForURL((url) => !url.pathname.includes('passkey'), { timeout: 30_000 });
  await friend.goto('/invite');
  await expect(friend.getByTestId('invite-referred-by')).toContainText(/came in on 0x/, { timeout: 30_000 });
  await friendContext.close();

  await page.reload();
  await expect(page.getByTestId('invite-friend')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByTestId('invite-totals').last()).toContainText('1');

  // --- And out. The passkey stays; the app asks for it again.
  await page.getByTestId('lobby-link').last().click({ force: true });
  await page.getByTestId('account-link').last().click({ force: true });
  await page.getByTestId('sign-out').last().click();
  await expect(page.getByText('Your account is a passkey')).toBeVisible({ timeout: 20_000 });
});
