/**
 * What the app remembers about the first visit, on a device.
 *
 * SecureStore is what the account layer already uses, so these ride along
 * rather than pulling in a second storage dependency for two booleans.
 */

import * as SecureStore from 'expo-secure-store';

export type NetworkChoice = 'testnet' | 'mainnet';

export type OnboardingPrefs = {
  /**
   * Which exchange the account lives on. Only testnet is built, so the first
   * visit no longer asks — a choice with one answer is not a choice. The field
   * stays because Account switches it once mainnet is reachable.
   */
  network: NetworkChoice;
  /** The promo is shown once; skipping counts as seeing it. */
  introSeen: boolean;
  /** The first strategy is taught once; skipping counts as learning it. */
  lessonSeen: boolean;
  /** Which strategies have had their lesson offered, by id. */
  taught: string[];
};

export const EMPTY_PREFS: OnboardingPrefs = { network: 'testnet', introSeen: false, lessonSeen: false, taught: [] };

const KEY = 'tradeagent.onboarding';

export async function loadPrefs(): Promise<OnboardingPrefs> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? { ...EMPTY_PREFS, ...(JSON.parse(raw) as Partial<OnboardingPrefs>) } : EMPTY_PREFS;
  } catch {
    return EMPTY_PREFS;
  }
}

export async function savePrefs(prefs: OnboardingPrefs): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(prefs));
  } catch {
    // The choice still holds for this launch.
  }
}

export async function clearPrefs(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Nothing to clear.
  }
}
