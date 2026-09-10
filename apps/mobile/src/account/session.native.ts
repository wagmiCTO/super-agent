/**
 * The unlocked session on a device: the wallet seed in the system keychain
 * (SecureStore, this device only, available once the phone is unlocked),
 * valid for a week. The passkey stays the way in; this is what lets the app
 * open straight onto the lobby the next morning, like a wallet does.
 */
import * as SecureStore from 'expo-secure-store';

import { fromHex, toHex } from './hex';

const KEY = 'tradeagent.session';

/** How long a session stays valid without a new passkey prompt. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Stored = { seed: string; until: number };

export async function saveSeed(seed: Uint8Array, ttlMs = SESSION_TTL_MS): Promise<void> {
  const stored: Stored = { seed: toHex(seed), until: Date.now() + ttlMs };
  await SecureStore.setItemAsync(KEY, JSON.stringify(stored), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}

export async function loadSeed(): Promise<Uint8Array | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  const stored = JSON.parse(raw) as Stored;
  if (!stored.seed || stored.until < Date.now()) {
    await clearSeed();
    return null;
  }
  return fromHex(stored.seed);
}

export async function clearSeed(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
