/**
 * The invite code a visitor arrived on, kept until there is a wallet to
 * attribute to it. SecureStore is what the rest of the app already uses;
 * this rides along rather than adding a second store for one string.
 */

import * as SecureStore from 'expo-secure-store';

const KEY = 'tradeagent.invite';

export async function savePendingInvite(code: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, code);
  } catch {
    // The invite is lost, the app is not.
  }
}

export async function pendingInvite(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

export async function clearPendingInvite(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Nothing to clear.
  }
}
