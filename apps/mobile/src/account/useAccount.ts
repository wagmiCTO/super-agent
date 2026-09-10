/**
 * The account layer as the screens see it.
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
import { useCallback, useEffect, useRef, useState } from 'react';

import { setAccountAddress, setRequestSigner } from '@/api/client';
import { registerAuthKey } from '@/exchange/enroll';
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

export function useAccount() {
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
    registerAuthKey(family).catch((e) => console.warn('request-signing key not registered', e));
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
    async (run: () => Promise<{ prfOutput: Uint8Array; credential: StoredAccount['credential'] }>, label: string) => {
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
        setState({ status: 'unlocked', stored, wallet: family.wallet, keys: family });
      } catch (e) {
        setError(describePasskeyError(e));
      } finally {
        setBusy(false);
      }
    },
    [adopt],
  );

  const create = useCallback((label = 'TradeAgent account') => unlock(() => createPasskey(label), label), [unlock]);

  const signIn = useCallback(() => {
    const known = state.status === 'remembered' || state.status === 'unlocked' ? state.stored : undefined;
    return unlock(() => signInWithPasskey(known?.credential), known?.label ?? 'TradeAgent account');
  }, [state, unlock]);

  const signOut = useCallback(async () => {
    drop();
    await clearSeed();
    await clearStoredAccount();
    setState({ status: 'none' });
  }, [drop]);

  return { state, busy, error, create, signIn, signOut };
}

function describePasskeyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/NotAllowedError|cancel|abort/i.test(msg)) return 'Passkey prompt was cancelled';
  if (/PRF|prf/.test(msg)) return 'This passkey provider does not support PRF. On desktop Chrome, save passkeys to Google Password Manager or use iCloud Keychain / 1Password.';
  return msg;
}
