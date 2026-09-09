/**
 * The trading loop every strategy screen shares: the account state polled
 * from the platform, the market's fee schedule, open and close, and the
 * notice that explains what just happened — including a position the
 * platform closed by its horizon while the user was away.
 *
 * A strategy screen decides *when* to offer an entry and how it looks; this
 * hook is how the entry is made. Every order goes through the platform, which
 * puts it through the policy engine before the venue.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, ApiError, describeError, type Market, type Position, type State } from '@/api/client';
import { DEFAULT_LEVERAGE, STATE_POLL_MS } from '@/config';
import { trim } from '@/components/format';

export type Notice = { text: string; kind: 'error' | 'info' };
export type Busy = 'up' | 'down' | 'close' | null;

export function useTrading(symbol: string) {
  const [state, setState] = useState<State | null>(null);
  const [market, setMarket] = useState<Market | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [offline, setOffline] = useState(false);
  const mounted = useRef(true);
  // The last close the screen has already explained, so a horizon close is
  // announced once and not on every poll.
  const explainedClose = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api.state();
      if (!mounted.current) return;
      setState(s);
      setOffline(false);
      // A position closed by its horizon while the user was away is news.
      const last = s.last_close;
      if (last && last.reason === 'horizon' && explainedClose.current !== last.at) {
        if (explainedClose.current !== null) {
          setNotice({ text: `Closed by timer @ ${trim(last.price)}, ${Number(last.pnl) >= 0 ? '+' : ''}${trim(last.pnl)}`, kind: 'info' });
        }
        explainedClose.current = last.at;
      } else if (explainedClose.current === null) {
        explainedClose.current = last?.at ?? '';
      }
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof ApiError && e.code === 'network') setOffline(true);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    api
      .markets()
      .then((ms) => mounted.current && setMarket(ms.find((m) => m.symbol === symbol) ?? null))
      .catch(() => undefined);
    const id = setInterval(refresh, STATE_POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [refresh, symbol]);

  const position: Position | null = state?.positions.find((p) => p.symbol === symbol) ?? null;

  const open = useCallback(
    async (side: 'long' | 'short', notional: string, horizonSeconds: number) => {
      setBusy(side === 'long' ? 'up' : 'down');
      setNotice(null);
      try {
        const order = await api.open({ symbol, side, notional, leverage: DEFAULT_LEVERAGE, horizon_seconds: horizonSeconds });
        if (order.status === 'failed') {
          setNotice({ text: `The exchange refused: ${order.rejection?.code ?? 'unknown'}`, kind: 'error' });
        } else {
          setNotice({ text: `Filled ${order.filled_size} @ ${order.avg_price}, fee ${order.fee}`, kind: 'info' });
        }
        await refresh();
      } catch (e) {
        setNotice({ text: describeError(e), kind: 'error' });
      } finally {
        setBusy(null);
      }
    },
    [refresh, symbol],
  );

  const close = useCallback(async () => {
    setBusy('close');
    setNotice(null);
    try {
      const order = await api.close({ symbol });
      setNotice({ text: `Closed ${order.filled_size} @ ${order.avg_price}, fee ${order.fee}`, kind: 'info' });
      await refresh();
    } catch (e) {
      setNotice({ text: describeError(e), kind: 'error' });
    } finally {
      setBusy(null);
    }
  }, [refresh, symbol]);

  return { state, market, position, busy, notice, offline, refresh, open, close };
}
