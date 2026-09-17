/**
 * The draft of your own strategy and whether you asked to be told when it
 * opens, on a device. Rides on the storage the account layer already uses.
 */

import * as SecureStore from 'expo-secure-store';

export type OwnDraft = { text: string; listed: boolean };

const KEY = 'tradeagent.own';

export async function loadOwnDraft(): Promise<OwnDraft> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? { text: '', listed: false, ...(JSON.parse(raw) as Partial<OwnDraft>) } : { text: '', listed: false };
  } catch {
    return { text: '', listed: false };
  }
}

export async function saveOwnDraft(draft: OwnDraft): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(draft));
  } catch {
    // The draft holds for this launch.
  }
}
