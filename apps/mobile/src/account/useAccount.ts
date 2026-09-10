/**
 * The account layer as the screens see it.
 *
 * `create` and `signIn` run a passkey ceremony, derive the wallet and hold a
 * signing session in memory. The seed is also kept in the device's session
 * store (keychain on a phone, the tab's sessionStorage on the web) so the
 * next visit opens unlocked; `signOut` ends the session and forgets both.
 * The passkey itself stays with the platform.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { deriveWallet, prfOutputToSeed, type Wallet } from './derive';
import { createPasskey, signInWithPasskey } from './passkey';
import { clearSeed, loadSeed, saveSeed } from './session';
import { clearStoredAccount, loadStoredAccount, saveStoredAccount, type StoredAccount } from './storage';

export type AccountState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'remembered'; stored: StoredAccount }
  | { status: 'unlocked'; stored: StoredAccount; wallet: Wallet };

export function useAccount() {
  const [state, setState] = useState<AccountState>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const walletRef = useRef<Wallet | null>(null);

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
        const wallet = deriveWallet(seed);
        seed.fill(0);
        if (wallet.address === stored.address) {
          walletRef.current = wallet;
          setState({ status: 'unlocked', stored, wallet });
          return;
        }
        wallet.session.end();
        await clearSeed();
      }
      setState({ status: 'remembered', stored });
    })();
    return () => {
      cancelled = true;
      walletRef.current?.session.end();
    };
  }, []);

  const unlock = useCallback(async (run: () => Promise<{ prfOutput: Uint8Array; credential: StoredAccount['credential'] }>, label: string) => {
    setBusy(true);
    setError(null);
    try {
      const { prfOutput, credential } = await run();
      const seed = prfOutputToSeed(prfOutput);
      prfOutput.fill(0);
      walletRef.current?.session.end();
      const wallet = deriveWallet(seed);
      await saveSeed(seed);
      seed.fill(0);
      walletRef.current = wallet;
      const stored: StoredAccount = { credential, address: wallet.address, label };
      await saveStoredAccount(stored);
      setState({ status: 'unlocked', stored, wallet });
    } catch (e) {
      setError(describePasskeyError(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const create = useCallback(
    (label = 'TradeAgent account') => unlock(() => createPasskey(label), label),
    [unlock],
  );

  const signIn = useCallback(() => {
    const known = state.status === 'remembered' || state.status === 'unlocked' ? state.stored : undefined;
    return unlock(() => signInWithPasskey(known?.credential), known?.label ?? 'TradeAgent account');
  }, [state, unlock]);

  const signOut = useCallback(async () => {
    walletRef.current?.session.end();
    walletRef.current = null;
    await clearSeed();
    await clearStoredAccount();
    setState({ status: 'none' });
  }, []);

  return { state, busy, error, create, signIn, signOut };
}

function describePasskeyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/NotAllowedError|cancel|abort/i.test(msg)) return 'Passkey prompt was cancelled';
  if (/PRF|prf/.test(msg)) return 'This passkey provider does not support PRF. On desktop Chrome, save passkeys to Google Password Manager or use iCloud Keychain / 1Password.';
  return msg;
}
