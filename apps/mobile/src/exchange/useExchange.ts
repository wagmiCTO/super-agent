/**
 * Exchange connection state for the unlocked wallet: whether the platform
 * already holds an enrolled key for it, and the action to enroll one.
 */
import { useCallback, useEffect, useState } from 'react';

import type { Wallet } from '@/account/derive';
import { describeError, setAccountAddress } from '@/api/client';
import { connectExchange, enrolledKey, type EnrolledKey } from './enroll';

export type ExchangeState =
  | { status: 'unknown' }
  | { status: 'not-connected' }
  | { status: 'connected'; key: EnrolledKey };

export function useExchange(wallet: Wallet | null) {
  const [state, setState] = useState<ExchangeState>({ status: 'unknown' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!wallet) {
      setState({ status: 'unknown' });
      setAccountAddress(null);
      return;
    }
    enrolledKey(wallet.address)
      .then((key) => {
        if (cancelled) return;
        setState(key ? { status: 'connected', key } : { status: 'not-connected' });
        setAccountAddress(key ? wallet.address : null);
      })
      .catch(() => !cancelled && setState({ status: 'not-connected' }));
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  const connect = useCallback(async () => {
    if (!wallet) return;
    setBusy(true);
    setError(null);
    try {
      const key = await connectExchange(wallet);
      setState({ status: 'connected', key });
      // From here on the screen acts for this wallet, not the platform's own account.
      setAccountAddress(wallet.address);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }, [wallet]);

  return { state, busy, error, connect };
}
