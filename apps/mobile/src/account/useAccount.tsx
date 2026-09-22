/**
 * The account layer as the screens see it.
 *
 * One instance for the whole app, in a provider at the root. It was a hook
 * per screen, and that is wrong twice over: a screen opened cold — a deep
 * link, a reload on /invite — had no account layer mounted at all, so its
 * first requests went out with no wallet on them and the platform answered
 * "sign in"; and when a screen that did mount one was left, its cleanup
 * cleared the signing key for every screen still open.
 *
 * `create` and `signIn` run a passkey ceremony and derive the key family —
 * the wallet, the request-signing key, and a strategy key per strategy on
 * demand — holding it in memory. The seed is also kept in the device's
 * session store (keychain on a phone, the tab's sessionStorage on the web)
 * so the next visit opens unlocked; `signOut` ends the session and forgets
 * both. The passkey itself stays with the platform.
 *
 * While unlocked, every request to the platform acts for the wallet and is
 * signed by the request-signing key; the key is registered with the
 * platform on each unlock (idempotent, silent — the wallet signs it).
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { api, ApiError, setAccountAddress, setRequestSigner } from '@/api/client';
import { registerAuthKey } from '@/exchange/enroll';
import { clearPendingInvite, pendingInvite } from '@/invite/pending';
import { track } from '@/analytics/track';
import { registerForPush } from '@/push/register';
import { KeyFamily, prfOutputToSeed, type Wallet } from './derive';
import { toHex } from './hex';
import { createPasskey, signInWithPasskey } from './passkey';
import { clearSeed, loadSeed, saveSeed } from './session';
import { clearStoredAccount, loadStoredAccount, saveStoredAccount, type StoredAccount } from './storage';

export type AccountState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'remembered'; stored: StoredAccount }
  | { status: 'unlocked'; stored: StoredAccount; wallet: Wallet; keys: KeyFamily };

export type Account = {
  state: AccountState;
  busy: boolean;
  error: string | null;
  create: (label?: string) => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AccountContext = createContext<Account | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  return <AccountContext.Provider value={useAccountState()}>{children}</AccountContext.Provider>;
}

/** The account, from the provider at the root. */
export function useAccount(): Account {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccount outside AccountProvider');
  return ctx;
}

function useAccountState(): Account {
  const [state, setState] = useState<AccountState>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const familyRef = useRef<KeyFamily | null>(null);

  /** Makes a family current: requests act for its wallet and are signed by it. */
  const adopt = useCallback((family: KeyFamily) => {
    familyRef.current?.end();
    familyRef.current = family;
    setRequestSigner({
      publicKey: toHex(family.auth.publicKey),
      sign: (message) => family.auth.session.signMessage(message),
    });
    setAccountAddress(family.wallet.address);
    // Registration is silent and idempotent; a failure only means requests
    // stay routed by address, which the platform still serves.
    // Three errands, not one chain. Where to reach this device runs after the
    // signing key because the platform answers a signed request, but it runs
    // whether or not that key registered: hung off the same `.then` it was
    // simply skipped when anything above it failed, and the notifications
    // went down with a problem that had nothing to do with them.
    void registerAuthKey(family)
      .then(claimPendingInvite)
      .catch((e) => console.warn('request-signing key not registered', e))
      .finally(() => void registerForPush());
  }, []);

  const drop = useCallback(() => {
    familyRef.current?.end();
    familyRef.current = null;
    setRequestSigner(null);
    setAccountAddress(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadStoredAccount();
      if (cancelled) return;
      if (!stored) {
        setState({ status: 'none' });
        return;
      }
      // A live session restores the wallet without a passkey prompt.
      const seed = await loadSeed().catch(() => null);
      if (cancelled) return;
      if (seed) {
        const family = new KeyFamily(seed);
        seed.fill(0);
        if (family.wallet.address === stored.address) {
          adopt(family);
          setState({ status: 'unlocked', stored, wallet: family.wallet, keys: family });
          return;
        }
        family.end();
        await clearSeed();
      }
      setState({ status: 'remembered', stored });
    })();
    return () => {
      cancelled = true;
      drop();
    };
  }, [adopt, drop]);

  const unlock = useCallback(
    async (run: () => Promise<{ prfOutput: Uint8Array; credential: StoredAccount['credential'] }>, label: string, fresh: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const { prfOutput, credential } = await run();
        const seed = prfOutputToSeed(prfOutput);
        prfOutput.fill(0);
        const family = new KeyFamily(seed);
        await saveSeed(seed);
        seed.fill(0);
        adopt(family);
        const stored: StoredAccount = { credential, address: family.wallet.address, label };
        await saveStoredAccount(stored);
        // Only a new account counts: signing in again is the same person
        // coming back, and counting it would flatter the funnel.
        if (fresh) track('passkey_created');
        setState({ status: 'unlocked', stored, wallet: family.wallet, keys: family });
      } catch (e) {
        const said = describePasskeyError(e);
        // Bucketed, never the message: a raw one names the person's password
        // manager, and the count is what tells us whether this is one friend
        // or everybody.
        track('passkey_failed', {
          reason: /cannot hold your account/.test(said) ? 'prf' : /cancelled/.test(said) ? 'cancelled' : 'other',
        });
        setError(said);
      } finally {
        setBusy(false);
      }
    },
    [adopt],
  );

  const create = useCallback((label = 'Tap Trader account') => unlock(() => createPasskey(label), label, true), [unlock]);

  const signIn = useCallback(() => {
    const known = state.status === 'remembered' || state.status === 'unlocked' ? state.stored : undefined;
    return unlock(() => signInWithPasskey(known?.credential), known?.label ?? 'Tap Trader account', false);
  }, [state, unlock]);

  const signOut = useCallback(async () => {
    drop();
    await clearSeed();
    await clearStoredAccount();
    setState({ status: 'none' });
  }, [drop]);

  return { state, busy, error, create, signIn, signOut };
}

/**
 * Everything an error and the errors under it say, outermost first.
 *
 * A passkey library reports its own label and keeps the platform's reason
 * beneath it: a creation that failed inside the ceremony arrives as "Passkey
 * creation failed" with the real cause in `cause`. Reading only the outer
 * message therefore recognises nothing.
 */
function causeChain(e: unknown): string[] {
  const out: string[] = [];
  for (let cur: unknown = e, depth = 0; cur != null && depth < 8; depth += 1) {
    const err = cur as { message?: unknown; code?: unknown; cause?: unknown };
    if (typeof err.code === 'string') out.push(err.code);
    const msg = cur instanceof Error ? cur.message : String(cur);
    if (msg) out.push(msg);
    cur = err.cause;
  }
  return out;
}

/**
 * Why the passkey did not work, in words that say what to do next.
 *
 * The account is derived from the passkey itself through the WebAuthn PRF
 * extension: the passkey is not a login to an account we keep, it *is* the
 * key. A password manager that stores passkeys but does not implement PRF
 * therefore cannot hold this account, and it fails after the prompt, which
 * reads as our bug rather than as a missing feature. One sentence for what
 * happened and one for the way out — on a red card, nobody reads a third.
 */
function describePasskeyError(e: unknown): string {
  const all = causeChain(e).join(' · ');
  if (/NotAllowedError|cancel|abort/i.test(all)) return 'Passkey prompt was cancelled';
  if (/PRF_UNAVAILABLE|PRF|prf/.test(all)) {
    if (Platform.OS === 'ios') return 'This password manager cannot hold your account. Turn on iCloud Keychain in Settings › General › AutoFill & Passwords, then try again.';
    if (Platform.OS === 'android') return 'This password manager cannot hold your account. Make Google Password Manager the passkey provider in Settings, then try again.';
    return 'This password manager cannot hold your account. Save the passkey to iCloud Keychain, Google Password Manager or 1Password instead.';
  }
  // The innermost message is the platform's own; the ones above it are labels.
  const chain = causeChain(e).filter((m) => !/^[A-Z_]+$/.test(m));
  return chain[chain.length - 1] ?? 'The passkey did not work';
}

/**
 * The invite this device arrived on, claimed now that there is a wallet.
 *
 * After the registration, because the claim names the wallet and the
 * platform answers a wallet only on a signed request. Silent either way:
 * an invite that cannot be claimed is not worth a screen, and the code is
 * kept until one is — a friend who signs in before the platform is up
 * still gets attributed on the next visit.
 */
async function claimPendingInvite(): Promise<void> {
  const code = await pendingInvite();
  if (!code) return;
  try {
    await api.claimReferral(code);
    await clearPendingInvite();
  } catch (e) {
    // A code nobody owns is never going to be claimed: drop it rather than
    // asking the platform about it on every unlock.
    if (e instanceof ApiError && e.code === 'no_such_code') await clearPendingInvite();
  }
}
