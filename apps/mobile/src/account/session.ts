/**
 * The unlocked session on the web: the wallet seed kept in sessionStorage
 * for the life of the tab, so a reload does not ask for the passkey again.
 * It is gone when the tab closes; localStorage would outlive the visit and
 * is the wrong place for a key on a shared browser.
 */

import { fromHex, toHex } from './hex';

const KEY = 'tradeagent.session';

/** How long a session stays valid without a new passkey prompt. */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

type Stored = { seed: string; until: number };

export async function saveSeed(seed: Uint8Array, ttlMs = SESSION_TTL_MS): Promise<void> {
  try {
    const stored: Stored = { seed: toHex(seed), until: Date.now() + ttlMs };
    globalThis.sessionStorage?.setItem(KEY, JSON.stringify(stored));
  } catch {
    // Blocked storage: the session lives in memory only.
  }
}

export async function loadSeed(): Promise<Uint8Array | null> {
  try {
    const raw = globalThis.sessionStorage?.getItem(KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Stored;
    if (!stored.seed || stored.until < Date.now()) {
      await clearSeed();
      return null;
    }
    return fromHex(stored.seed);
  } catch {
    return null;
  }
}

export async function clearSeed(): Promise<void> {
  try {
    globalThis.sessionStorage?.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
