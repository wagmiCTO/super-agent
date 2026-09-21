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

import { api, ApiError, currentAccountAddress, describeError, type AmendRequest, type ErrorCode, type Market, type Order, type Position, type State, type Trade } from '@/api/client';
import { DEFAULT_LEVERAGE, STATE_POLL_MS } from '@/config';
import { refreshRiskReport } from '@/trading/useRiskReport';

/**
 * What just happened, in a line. `code` is the platform's own reason when
 * it refused, so the screen can offer the way out of that particular
 * refusal rather than only repeating it.
 */
export type Notice = { text: string; kind: 'error' | 'info'; code?: ErrorCode };
export type Busy = 'up' | 'down' | 'close' | 'reverse' | 'amend' | null;

/** How long a reversal waits between the close and the opposite open. */
const REVERSE_PAUSE_MS = 2000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A refusal as a notice: what it says, and which rule said it. */
function refusal(e: unknown): Notice {
  return { text: describeError(e), kind: 'error', ...(e instanceof ApiError ? { code: e.code } : null) };
}

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

  // The account holds one position per market whatever the strategy, and
  // the platform says which strategy's tap opened each. This strategy's
  // own is the one it opened, wherever the screen's market menu is; a
  // position the platform cannot place (opened outside it) counts as this
  // market's while the screen is on that market.
  const positions: Position[] = state?.positions ?? [];
  const position: Position | null = positions.find((p) => p.strategy === strategy) ?? positions.find((p) => !p.strategy && p.symbol === symbol) ?? null;

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
        refreshRiskReport();
      } catch (e) {
        setNotice(refusal(e));
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
      refreshRiskReport();
      return order;
    } catch (e) {
      setNotice({ text: describeError(e), kind: 'error' });
      return null;
    } finally {
      setBusy(null);
    }
  }, [refresh, symbol, strategy]);

  /**
   * Re-arms the position's exits: the stop, the target, more time. The
   * platform answers with the exits as they stand; the state is re-read
   * for the rest. False when it refused.
   */
  const amend = useCallback(
    async (change: Omit<AmendRequest, 'symbol' | 'strategy'>): Promise<boolean> => {
      setBusy('amend');
      setNotice(null);
      try {
        await api.amend({ symbol, strategy, ...change });
        await refresh();
        refreshRiskReport();
        return true;
      } catch (e) {
        setNotice({ text: describeError(e), kind: 'error' });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [refresh, symbol, strategy],
  );

  /**
   * Closes the position and, a moment later, opens the other side with the
   * same terms: the same value and leverage, the same stop and target, and
   * a horizon as long as the one just ended. Two taps' worth of orders,
   * each through the platform's one path; a refusal of the second — the
   * cooldown, say — is waited out once and then reported, and the account
   * is simply flat.
   */
  const reverse = useCallback(async (): Promise<void> => {
    const p = position;
    if (!p) return;
    setBusy('reverse');
    setNotice(null);
    try {
      await api.close({ symbol: p.symbol, strategy });
      const horizon = p.closes_at && p.opened_at ? Math.max(0, Math.round((new Date(p.closes_at).getTime() - new Date(p.opened_at).getTime()) / 1000)) : 0;
      const body = {
        symbol: p.symbol,
        side: (p.side === 'long' ? 'short' : 'long') as 'long' | 'short',
        notional: String(Number(p.notional).toFixed(2)),
        leverage: String(Number(p.leverage)),
        horizon_seconds: horizon,
        strategy,
        ...(p.max_loss && Number(p.max_loss) > 0 ? { max_loss: p.max_loss } : {}),
        ...(p.take_profit && Number(p.take_profit) > 0 ? { take_profit: p.take_profit } : {}),
      };
      await sleep(REVERSE_PAUSE_MS);
      let order: Order;
      try {
        order = await api.open(body);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'cooldown' && e.retryAfterSeconds) {
          await sleep(Math.ceil(e.retryAfterSeconds) * 1000 + 250);
          order = await api.open(body);
        } else {
          throw e;
        }
      }
      if (order.status === 'failed') {
        setNotice({ text: `Closed, but the exchange refused the other side: ${order.rejection?.code ?? 'unknown'}`, kind: 'error' });
      }
      await refresh();
      refreshRiskReport();
    } catch (e) {
      setNotice({ text: describeError(e), kind: 'error' });
      await refresh();
    } finally {
      setBusy(null);
    }
  }, [position, refresh, strategy]);

  return { state, stateFor, market, position, positions, trades, busy, notice, offline, locked, refresh, open, close, amend, reverse };
}
