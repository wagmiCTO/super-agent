import { expect, test } from '@playwright/test';

import { asReturningUser } from './onboarded';

/**
 * Light is the default; dark is chosen on the account screen, turns the page
 * dark at once, and is still the choice after a reload.
 */
test('the account screen switches the app to dark and back', async ({ page, context }) => {
  test.setTimeout(200_000);
  await asReturningUser(page, context);
  await page.goto('/account');
  await expect(page.getByTestId('account-title').last()).toBeVisible({ timeout: 20_000 });

  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await background()).toBe('rgb(255, 255, 255)');

  await page.getByTestId('theme-dark').last().click();
  await expect.poll(background).toBe('rgb(19, 18, 21)');

  await page.reload();
  await expect(page.getByTestId('account-title').last()).toBeVisible({ timeout: 20_000 });
  await expect.poll(background).toBe('rgb(19, 18, 21)');

  await page.getByTestId('theme-light').last().click();
  await expect.poll(background).toBe('rgb(255, 255, 255)');
});
