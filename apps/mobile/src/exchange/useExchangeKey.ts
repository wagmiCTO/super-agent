/**
 * The wallet's exchange key: whether the platform already holds one, and
 * the action to enroll it. One key serves every strategy (ADR 0007).
 */
import { useCallback, useEffect, useState } from 'react';

import type { KeyFamily } from '@/account/derive';
import { describeError } from '@/api/client';
import { enrollExchangeKey, exchangeKey, type EnrolledKey } from './enroll';

export type ExchangeKeyState =
  | { status: 'unknown' }
  | { status: 'missing' }
  | { status: 'enabled'; key: EnrolledKey };

export function useExchangeKey(keys: KeyFamily | null) {
  const [state, setState] = useState<ExchangeKeyState>({ status: 'unknown' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!keys) {
      setState({ status: 'unknown' });
      return;
    }
    exchangeKey(keys.wallet.address)
      .then((key) => !cancelled && setState(key ? { status: 'enabled', key } : { status: 'missing' }))
      .catch(() => !cancelled && setState({ status: 'missing' }));
    return () => {
      cancelled = true;
    };
  }, [keys]);

  const enable = useCallback(async () => {
    if (!keys) return;
    setBusy(true);
    setError(null);
    try {
      const key = await enrollExchangeKey(keys);
      setState({ status: 'enabled', key });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }, [keys]);

  return { state, busy, error, enable };
}
