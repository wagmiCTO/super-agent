/**
 * The invite code a visitor arrived on, kept until there is a wallet to
 * attribute to it.
 *
 * A friend follows a link, then goes through the promo and a passkey before
 * the platform knows who they are — so the code has to outlive all of that,
 * and a reload in the middle of it. Not a secret: it names the wallet that
 * invited them, which is on the board anyway.
 */

const KEY = 'tradeagent.invite';

export async function savePendingInvite(code: string): Promise<void> {
  try {
    globalThis.localStorage?.setItem(KEY, code);
  } catch {
    // Blocked storage: the invite is lost, the app is not.
  }
}

export async function pendingInvite(): Promise<string | null> {
  try {
    return globalThis.localStorage?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

export async function clearPendingInvite(): Promise<void> {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
