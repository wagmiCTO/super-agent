/**
 * What the app remembers about the first visit, on a device.
 *
 * SecureStore is what the account layer already uses, so these ride along
 * rather than pulling in a second storage dependency for two booleans.
 */

import * as SecureStore from 'expo-secure-store';

export type NetworkChoice = 'testnet' | 'mainnet';

export type OnboardingPrefs = {
  network: NetworkChoice | null;
  /** The promo is shown once; skipping counts as seeing it. */
  introSeen: boolean;
};

export const EMPTY_PREFS: OnboardingPrefs = { network: null, introSeen: false };

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
