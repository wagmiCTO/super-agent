/**
 * Where the chosen appearance is kept, on a device.
 *
 * SecureStore is what the account layer and the position settings already
 * use, so this rides along rather than pulling in a second storage dependency.
 */

import * as SecureStore from 'expo-secure-store';

import type { ThemeName } from '@/constants/theme';

const KEY = 'tradeagent.theme';

/** The skin this phone chose, or null when it never chose one. */
export async function loadThemeChoice(): Promise<ThemeName | null> {
  try {
    return parse(await SecureStore.getItemAsync(KEY));
  } catch {
    return null;
  }
}

export async function saveThemeChoice(name: ThemeName): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, name);
  } catch {
    // The choice still holds for this launch.
  }
}

/** Only the skins a person can pick; anything else is no choice at all. */
export function parse(raw: string | null): ThemeName | null {
  return raw === 'paper' || raw === 'night' ? raw : null;
}
