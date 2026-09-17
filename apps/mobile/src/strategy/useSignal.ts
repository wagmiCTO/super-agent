/**
 * The signal a strategy waits for, polled from the platform.
 *
 * Both signal strategies answer the same two questions — is a side named
 * right now, and what was the last one — so the screen reads one shape and
 * the per-strategy wording stays in the screen.
 *
 * Direction has no signal: the call is the user's, always. It returns `null`
 * rather than a dark banner, so the screen can ask its question instead.
 */

import { useEffect, useState } from 'react';

import { api, type MACrossSignal, type RSISignal, type Side } from '@/api/client';
import { SIGNAL_POLL_MS } from '@/config';

export type StrategyId = 'direction' | 'ma-cross' | 'rsi';

export type Signal = {
  /** The side on offer right now, or null while nothing is lit. */
  side: Side | null;
  /** When the window opened and when it closes; null while nothing is lit. */
  openedAt: string | null;
  expiresAt: string | null;
  /** The line under the headline: what the signal saw. */
  detail: string;
  /** What to say while nothing is lit. */
  quiet: string;
  /** When the last one was, in words. */
  last: string | null;
  ready: boolean;
  /** RSI only: the index right now, 0..100, for the thermometer on the pane. */
  value?: number;
  /** MA Cross only: the two averages the chart draws, which is on top, and where they last crossed. */
  averages?: { fast: number; slow: number; trend: 'up' | 'down' | 'flat'; lastCross: { at: string; side: Side } | null };
  /** RSI only: when the index last entered a zone. */
  lastAt?: string | null;
};

/**
 * The signal on the chart's own timeframe: the platform runs the same rule
 * on every bar size, so what the screen shows for a timeframe is what the
 * lines on that chart did. `interval` is the chart's, in minutes.
 */
export function useSignal(id: StrategyId, symbol: string, interval = '1'): Signal | null {
  const periodSeconds = Math.max(60, Number(interval) * 60 || 60);
  // The answer is kept with what it answers: a timeframe's own signal, not
  // the last one's — the window and the last cross differ by timeframe,
  // and a stale one would light the keys.
  const key = `${id}:${symbol}:${periodSeconds}`;
  const [got, setGot] = useState<{ key: string; signal: Signal } | null>(null);

  useEffect(() => {
    if (id === 'direction') return;
    let alive = true;
    const read = () =>
      (id === 'ma-cross' ? api.maCross(symbol, periodSeconds).then(fromCross) : api.rsi(symbol, periodSeconds).then(fromRsi))
        .then((s) => alive && setGot({ key, signal: s }))
        .catch(() => undefined);
    void read();
    const timer = setInterval(read, SIGNAL_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id, symbol, periodSeconds, key]);

  return id === 'direction' || got?.key !== key ? null : got.signal;
}

function fromCross(s: MACrossSignal): Signal {
  const side = s.window?.side ?? null;
  return {
    side,
    openedAt: s.window?.opened_at ?? null,
    expiresAt: s.window?.expires_at ?? null,
    detail: side === 'long' ? 'cross up' : side === 'short' ? 'cross down' : `trend ${s.trend}`,
    quiet: s.ready ? 'waiting for a cross' : 'warming up',
    last: s.last_cross ? `last ${s.last_cross.side === 'long' ? '↑' : '↓'} ${hm(s.last_cross.at)}` : null,
    ready: s.ready,
    averages: { fast: s.fast, slow: s.slow, trend: s.trend, lastCross: s.last_cross ? { at: s.last_cross.at, side: s.last_cross.side } : null },
  };
}

function fromRsi(s: RSISignal): Signal {
  const side = s.window?.side ?? null;
  const value = Math.round(Number(s.value));
  return {
    side,
    openedAt: s.window?.opened_at ?? null,
    expiresAt: s.window?.expires_at ?? null,
    detail: `RSI ${value}${side === 'long' ? ' · oversold' : side === 'short' ? ' · overbought' : ''}`,
    quiet: s.ready ? `waiting for a zone` : 'warming up',
    last: s.ready ? `RSI ${value}` : null,
    ready: s.ready,
    value: s.ready && Number.isFinite(value) ? value : undefined,
    lastAt: s.last_cross?.at ?? null,
  };
}

function hm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
