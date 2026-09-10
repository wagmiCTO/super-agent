/**
 * A strategy's key for the unlocked wallet: whether the platform already
 * holds one, and the action to enable the strategy by enrolling it. Also
 * the wallet-wide view — which strategies are enabled — for the lobby.
 */
import { useCallback, useEffect, useState } from 'react';

import type { KeyFamily } from '@/account/derive';
import { describeError } from '@/api/client';
import { enableStrategy, enrolledKeys, strategyKey, type EnrolledKey } from './enroll';

export type StrategyKeyState =
  | { status: 'unknown' }
  | { status: 'missing' }
  | { status: 'enabled'; key: EnrolledKey };

export function useStrategyKey(keys: KeyFamily | null, strategy: string) {
  const [state, setState] = useState<StrategyKeyState>({ status: 'unknown' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!keys) {
      setState({ status: 'unknown' });
      return;
    }
    strategyKey(keys.wallet.address, strategy)
      .then((key) => !cancelled && setState(key ? { status: 'enabled', key } : { status: 'missing' }))
      .catch(() => !cancelled && setState({ status: 'missing' }));
    return () => {
      cancelled = true;
    };
  }, [keys, strategy]);

  const enable = useCallback(async () => {
    if (!keys) return;
    setBusy(true);
    setError(null);
    try {
      const key = await enableStrategy(keys, strategy);
      setState({ status: 'enabled', key });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }, [keys, strategy]);

  return { state, busy, error, enable };
}

/** The strategies a wallet has keys for; null until known. */
export function useEnabledStrategies(address: string | null, refreshKey: unknown = null): EnrolledKey[] | null {
  const [list, setList] = useState<EnrolledKey[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!address) {
      setList(null);
      return;
    }
    enrolledKeys(address)
      .then((ks) => !cancelled && setList(ks))
      .catch(() => !cancelled && setList([]));
    return () => {
      cancelled = true;
    };
  }, [address, refreshKey]);
  return list;
}
