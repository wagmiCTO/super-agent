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

import { api, ApiError, currentAccountAddress, describeError, type Market, type Order, type Position, type State, type Trade } from '@/api/client';
import { DEFAULT_LEVERAGE, STATE_POLL_MS } from '@/config';

export type Notice = { text: string; kind: 'error' | 'info' };
export type Busy = 'up' | 'down' | 'close' | null;

export function useTrading(symbol: string, strategy: string) {
  const [state, setState] = useState<State | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [market, setMarket] = useState<Market | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [offline, setOffline] = useState(false);
  // True when the platform serves enrolled wallets only and none is signed in.
  const [locked, setLocked] = useState(false);
  const mounted = useRef(true);

  // Which wallet the last answer was about, or null when the request carried
  // no wallet and the platform answered for its own account.
  const [stateFor, setStateFor] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const asked = currentAccountAddress();
      const s = await api.state(strategy);
      if (!mounted.current) return;
      setState(s);
      setStateFor(asked);
      setOffline(false);
      setLocked(false);
      // The chart marks and the history list this strategy's round trips;
      // they change only on a fill, so this follows the same poll.
      api
        .trades(symbol, strategy)
        .then((list) => mounted.current && setTrades(list))
        .catch(() => undefined);
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof ApiError && e.code === 'network') setOffline(true);
      if (e instanceof ApiError && (e.code === 'own_account_disabled' || e.code === 'no_key')) {
        setLocked(true);
        setState(null);
      }
    }
  }, [symbol, strategy]);

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

  // A fill is not announced in words: the screen becomes the position, which
  // is the answer to the tap. Only a refusal needs saying.
  const open = useCallback(
    async (side: 'long' | 'short', notional: string, horizonSeconds: number, maxLoss = '0', leverage = DEFAULT_LEVERAGE, takeProfit = '0') => {
      setBusy(side === 'long' ? 'up' : 'down');
      setNotice(null);
      try {
        const order = await api.open({
          symbol,
          side,
          notional,
          leverage,
          horizon_seconds: horizonSeconds,
          strategy,
          ...(maxLoss !== '0' ? { max_loss: maxLoss } : {}),
          ...(takeProfit !== '0' ? { take_profit: takeProfit } : {}),
        });
        if (order.status === 'failed') {
          setNotice({ text: `The exchange refused: ${order.rejection?.code ?? 'unknown'}`, kind: 'error' });
        }
        await refresh();
      } catch (e) {
        setNotice({ text: describeError(e), kind: 'error' });
      } finally {
        setBusy(null);
      }
    },
    [refresh, symbol, strategy],
  );

  /** Closes at market; the order, so the screen can find the round trip it ended. */
  const close = useCallback(async (): Promise<Order | null> => {
    setBusy('close');
    setNotice(null);
    try {
      const order = await api.close({ symbol, strategy });
      await refresh();
      return order;
    } catch (e) {
      setNotice({ text: describeError(e), kind: 'error' });
      return null;
    } finally {
      setBusy(null);
    }
  }, [refresh, symbol, strategy]);

  return { state, stateFor, market, position, trades, busy, notice, offline, locked, refresh, open, close };
}
