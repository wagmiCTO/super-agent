/**
 * What the app remembers between visits, on the web: the credential id, so
 * the next sign-in goes straight to the right passkey, and the address, so
 * the screen can render before any prompt. Never the PRF output or a key.
 */
import type { PasskeyCredentialTransport } from '@category-labs/mera';

export type StoredCredential = { credentialId: string; transports?: readonly PasskeyCredentialTransport[] };

export type StoredAccount = { credential: StoredCredential; address: string; label: string };

const KEY = 'tradeagent.account';

export async function loadStoredAccount(): Promise<StoredAccount | null> {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredAccount) : null;
  } catch {
    return null;
  }
}

export async function saveStoredAccount(account: StoredAccount): Promise<void> {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(account));
  } catch {
    // Private mode or blocked storage: the account still works for this visit.
  }
}

export async function clearStoredAccount(): Promise<void> {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
