/**
 * On a device the credential id and address live in SecureStore. The PRF
 * output is deliberately not stored yet: restoring an account without a
 * passkey prompt is a later step, gated behind a biometric check.
 */
import * as SecureStore from 'expo-secure-store';

import type { PasskeyCredentialTransport } from '@category-labs/mera';

export type StoredCredential = { credentialId: string; transports?: readonly PasskeyCredentialTransport[] };

export type StoredAccount = { credential: StoredCredential; address: string; label: string };

const KEY = 'tradeagent.account';

export async function loadStoredAccount(): Promise<StoredAccount | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? (JSON.parse(raw) as StoredAccount) : null;
}

export async function saveStoredAccount(account: StoredAccount): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(account));
}

export async function clearStoredAccount(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
