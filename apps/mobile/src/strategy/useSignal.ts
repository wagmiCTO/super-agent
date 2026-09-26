/**
 * The signal a strategy waits for, polled from the platform.
 *
 * Every signal strategy answers the same two questions — is a side named
 * right now, and what was the last one — so the screen reads one shape and
 * the per-strategy wording stays in the screen. What each strategy draws on
 * the chart besides rides along in its own optional field.
 *
 * Direction has no signal: the call is the user's, always. It returns `null`
 * rather than a dark banner, so the screen can ask its question instead.
 */

import { useEffect, useState } from 'react';

import { api, type DonchianSignal, type MACrossSignal, type ORBSignal, type RSISignal, type Side } from '@/api/client';
import { SIGNAL_POLL_MS } from '@/config';

export type StrategyId = 'direction' | 'ma-cross' | 'rsi' | 'donchian' | 'orb';

/** A close outside a channel or a range, as the chart marks it. */
export type Breakout = { at: string; side: Side; price: number; level: number };

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
  /** Turtles only: the channel the forming bar has to break, and the last break. */
  channel?: { length: number; upper: number | null; lower: number | null; lastBreak: Breakout | null };
  /** Open Range only: the session on the clock and its range so far. */
  range?: {
    phase: 'forming' | 'watching' | 'broken' | 'closed';
    /** The session open, HH:MM UTC, and when it was. */
    open: string;
    openAt: string;
    /** The range's bars: from the first one's open to when the range is set. */
    from: string;
    until: string;
    watchUntil: string;
    nextOpenAt: string;
    high: number | null;
    low: number | null;
    lastBreak: Breakout | null;
  };
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
    const fetch = (): Promise<Signal> => {
      switch (id) {
        case 'ma-cross':
          return api.maCross(symbol, periodSeconds).then(fromCross);
        case 'rsi':
          return api.rsi(symbol, periodSeconds).then(fromRsi);
        case 'donchian':
          return api.donchian(symbol, periodSeconds).then(fromDonchian);
        default:
          return api.orb(symbol, periodSeconds).then(fromOrb);
      }
    };
    const read = () =>
      fetch()
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

function breakoutOf(b: { at: string; side: Side; price: string; level: string } | undefined): Breakout | null {
  return b ? { at: b.at, side: b.side, price: Number(b.price), level: Number(b.level) } : null;
}

function fromDonchian(s: DonchianSignal): Signal {
  const side = s.window?.side ?? null;
  const last = breakoutOf(s.last_break);
  const upper = s.upper !== undefined ? Number(s.upper) : null;
  const lower = s.lower !== undefined ? Number(s.lower) : null;
  return {
    side,
    openedAt: s.window?.opened_at ?? null,
    expiresAt: s.window?.expires_at ?? null,
    detail: last && side ? `closed ${side === 'long' ? 'above' : 'below'} the ${s.length}-bar ${side === 'long' ? 'high' : 'low'} ${trim(last.level)}` : `channel ${trim(lower)} – ${trim(upper)}`,
    quiet: s.ready ? 'inside the channel' : 'warming up',
    last: last ? `last ${last.side === 'long' ? '↑' : '↓'} ${hm(last.at)}` : null,
    ready: s.ready,
    channel: { length: s.length, upper, lower, lastBreak: last },
  };
}

function fromOrb(s: ORBSignal): Signal {
  const side = s.window?.side ?? null;
  const ses = s.session;
  const last = breakoutOf(s.last_break);
  const high = ses.high !== undefined ? Number(ses.high) : null;
  const low = ses.low !== undefined ? Number(ses.low) : null;
  // Sessions are named by their open on the user's own clock: the lesson
  // gives the UTC times once, the screen shows what the phone shows.
  const open = hm(ses.open_at);
  const quiet =
    !s.ready ? 'warming up'
    : s.phase === 'forming' ? `range forming · ${hm(ses.range_until)}`
    : s.phase === 'watching' ? `range set · watching`
    : s.phase === 'broken' ? `broke ${ses.break?.side === 'long' ? 'up' : 'down'} · next ${hm(s.next_open_at)}`
    : `next open ${hm(s.next_open_at)} · ${inWords(s.next_open_at)}`;
  return {
    side,
    openedAt: s.window?.opened_at ?? null,
    expiresAt: s.window?.expires_at ?? null,
    detail: last && side ? `closed ${side === 'long' ? 'above' : 'below'} the ${open} range ${side === 'long' ? 'high' : 'low'} ${trim(last.level)}` : quiet,
    quiet,
    last: last ? `last ${last.side === 'long' ? '↑' : '↓'} ${hm(last.at)}` : null,
    ready: s.ready,
    range: {
      phase: s.phase,
      open,
      openAt: ses.open_at,
      from: ses.range_from,
      until: ses.range_until,
      watchUntil: ses.watch_until,
      nextOpenAt: s.next_open_at,
      high,
      low,
      lastBreak: last,
    },
  };
}

function hm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** How far away a moment is, in the coarse words a waiting screen wants. */
function inWords(iso: string): string {
  const min = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
  if (min < 60) return `in ${Math.max(1, min)} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `in ${h} h ${m} min` : `in ${h} h`;
}

/** A price with its own decimals and no trailing noise; a dash when there is none. */
function trim(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  return n >= 100 ? n.toFixed(2) : n >= 1 ? n.toFixed(4) : n.toPrecision(4);
}
