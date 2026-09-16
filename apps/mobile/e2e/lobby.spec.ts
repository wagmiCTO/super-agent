import { expect, test } from '@playwright/test';

import { asReturningUser } from './onboarded';

/**
 * The lobby lists every strategy with this week's board, straight from the
 * platform's ledger, and opens the strategy's own screen on a tap.
 */
test('the lobby shows each strategy with its week and opens it', async ({ page, context }) => {
  await asReturningUser(page, context);
  await expect(page.getByText('Choose a strategy')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('balance')).toHaveText(/^[\d.]+ AUSD$|^offline$|^…$/);

  for (const id of ['direction', 'ma-cross', 'rsi']) {
    const card = page.getByTestId(`strategy-${id}`);
    await expect(card).toBeVisible();
    // The week, in the design's money: a real minus sign and two decimals.
    await expect(card.getByTestId(`board-pnl-${id}`)).toHaveText(/^[+\u2212]?\d+\.\d\d this week · \d+ (trade|trades)$/);
    // The card's second line: the pool and who is in it.
    await expect(card.getByTestId(`prize-pool-${id}`)).toHaveText(/(Pool [\d.]+ AUSD|No pool yet) · \d+ (player|players)/);
  }

  await page.getByTestId('strategy-direction').click({ force: true });
  // The lobby stays mounted under the strategy in the navigator stack, so the
  // name appears twice — the screen on top is the last one.
  await expect(page).toHaveURL(/\/direction$/, { timeout: 20_000 });
  await expect(page.getByTestId('key-up').last()).toBeVisible({ timeout: 20_000 });
});

// Every link the design puts in the lobby leads somewhere: the screens that
// are not built yet open as stubs that say their name and lead back.
test('the lobby links open the screens the design names', async ({ page, context }) => {
  await asReturningUser(page, context);
  const lobby = page.getByText('Choose a strategy');
  await expect(lobby).toBeVisible({ timeout: 30_000 });

  // Each screen says its own name; only "your strategy" is still a stub.
  const screens: [string, string, string][] = [
    ['leaderboard-link', 'leaderboard-title', 'Leaderboard'],
    ['invite-link', 'invite-title', 'Invite friends'],
    ['history-link', 'history-title', 'History'],
    ['account-link', 'account-title', 'Account'],
    ['own-link', 'stub-title', 'Your strategy'],
  ];
  for (const [link, titleID, title] of screens) {
    await page.getByTestId(link).click({ force: true });
    await expect(page.getByTestId(titleID)).toHaveText(title, { timeout: 20_000 });
    // The screen sits on top of the lobby in the stack: the last link is its own.
    await page.getByTestId('lobby-link').last().click();
    await expect(page.getByTestId(titleID)).toBeHidden();
    await expect(lobby).toBeVisible();
  }

  // The network badge opens the menu; testnet is where the app lives, and
  // mainnet is there to be seen but not chosen yet.
  await page.getByTestId('network-badge').click();
  await expect(page.getByTestId('network-menu')).toBeVisible();
  await expect(page.getByTestId('network-mainnet')).toBeDisabled();
  await page.getByTestId('network-testnet').click();
  await expect(page.getByTestId('network-menu')).toBeHidden();

  // The prize banner leads to the board.
  await page.getByTestId('prize-banner').click({ force: true });
  await expect(page.getByTestId('leaderboard-title')).toHaveText('Leaderboard', { timeout: 20_000 });
  await page.getByTestId('lobby-link').last().click();
  await expect(lobby).toBeVisible();

  // Risk is the one footer link with a screen of its own.
  await page.getByTestId('risk-link').click({ force: true });
  await expect(page).toHaveURL(/\/risk$/, { timeout: 20_000 });
});

// The chain's record of the prize pools, from the indexer, lives on the
// leaderboard screen: before the first settlement it says so.
test('the leaderboard shows the on-chain prize pools from the indexer', async ({ page, context }) => {
  await asReturningUser(page, context);
  await page.getByTestId('leaderboard-link').click({ force: true });
  const past = page.getByTestId('past-weeks');
  await expect(past).toBeVisible({ timeout: 20_000 });
  // Upper case is a style, not the text: the caps variant renders it, the
  // DOM keeps what was written.
  await expect(past).toContainText(/prize pools/i);
  await expect(past).toContainText(/pools · [\d.]+ AUSD funded/);
  await expect(past).toContainText(/Indexed by Envio/);
  await expect(page.getByTestId('leaderboard-source')).toHaveText(/^Prizes paid by contract 0x[0-9a-f]{4}…[0-9a-f]{4} · week \d+/);

  // The board itself: a tab per strategy and all of them together, this week
  // or every trade on record. A fresh testnet has no closed trades on most
  // boards, so what is asserted is the line that says what is being played
  // for, which is there either way.
  await expect(page.getByTestId('board-pool')).toContainText(/players · ends \w+$|No pool yet/);
  await page.getByTestId('board-all').click();
  await expect(page.getByTestId('board-pool')).toContainText(/entries/);
  await page.getByTestId('period-all').click();
  await expect(page.getByTestId('board-pool')).toContainText(/^Since launch/, { timeout: 20_000 });
  await expect(page.getByTestId('board-note')).toContainText('The prize is weekly');
});
