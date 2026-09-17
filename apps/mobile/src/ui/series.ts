/**
 * The bars the illustrations are drawn from.
 *
 * The lesson artwork is a real chart, not a drawing of one: a seeded walk of
 * OHLC bars, moving averages computed from the closes, RSI from the formula.
 * A picture that only looks like a chart teaches the wrong shape, and a reader
 * who later opens the real screen finds nothing they recognise.
 *
 * Seeded, so every render and every screenshot shows the same market.
 */

export type Bar = { o: number; h: number; l: number; c: number };

/** A small deterministic generator — same seed, same walk, on every device. */
function rnd(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

export function ohlc(count: number, seed: number, drift = 0, vol = 1): Bar[] {
  const r = rnd(seed);
  const out: Bar[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    const o = price;
    const c = o + (r() - 0.5) * 3.4 * vol + drift;
    out.push({ o, c, h: Math.max(o, c) + r() * 1.5 * vol, l: Math.min(o, c) - r() * 1.5 * vol });
    price = c;
  }
  return out;
}

/** Simple moving average of the closes, one value per bar. */
export function sma(bars: Bar[], period: number): number[] {
  return bars.map((_, i) => {
    const window = bars.slice(Math.max(0, i - period + 1), i + 1);
    return window.reduce((sum, b) => sum + b.c, 0) / window.length;
  });
}

/**
 * Relative strength, one value per bar.
 *
 * The first `period` bars have no window behind them; they are returned so the
 * arrays line up, but a chart should start drawing after them rather than at
 * the fabricated 100.
 */
export function rsi(bars: Bar[], period = 14): number[] {
  return bars.map((_, i) => {
    const window = bars.slice(Math.max(1, i - period + 1), i + 1);
    let up = 0;
    let down = 0;
    window.forEach((bar, k) => {
      const prev = bars[Math.max(0, i - window.length + 1 + k - 1)].c;
      const move = bar.c - prev;
      if (move >= 0) up += move;
      else down -= move;
    });
    return down === 0 ? 100 : 100 - 100 / (1 + up / down);
  });
}

/** The last bar where the fast average crossed the slow one, or -1. */
export function lastCross(fast: number[], slow: number[], from = 15): number {
  for (let i = fast.length - 2; i > from; i--) {
    if ((fast[i] - slow[i]) * (fast[i - 1] - slow[i - 1]) < 0) return i;
  }
  return -1;
}

/** Maps a price onto a y coordinate inside a box, with a little headroom. */
export function scale(bars: Bar[], top: number, height: number) {
  const hi = Math.max(...bars.map((b) => b.h));
  const lo = Math.min(...bars.map((b) => b.l));
  const pad = (hi - lo) * 0.09 || 1;
  const max = hi + pad;
  const min = lo - pad;
  return (value: number) => top + height - ((value - min) / (max - min)) * height;
}

/**
 * A walk in legs: each leg has its own drift and volatility, so a chart can
 * be made to tell a story — a slide, a turn, a run — while every bar in it
 * is still a bar and not a drawing of one.
 */
export function ohlcLegs(seed: number, legs: { n: number; drift: number; vol?: number }[]): Bar[] {
  const r = rnd(seed);
  const out: Bar[] = [];
  let price = 100;
  for (const leg of legs) {
    const vol = leg.vol ?? 1;
    for (let i = 0; i < leg.n; i++) {
      const o = price;
      const c = o + (r() - 0.5) * 3.4 * vol + leg.drift;
      out.push({ o, c, h: Math.max(o, c) + r() * 1.5 * vol, l: Math.min(o, c) - r() * 1.5 * vol });
      price = c;
    }
  }
  return out;
}

/** The walk every illustration shares, so the lessons discuss one market. */
export const BARS = ohlc(46, 7, 0.12, 1);

/** A stretch that finishes oversold, for the screen that talks about it. */
export const COLD_BARS = ohlc(46, 23, -0.78, 1.15);

/** A slide and a turn: the shape a moving-average cross is about. */
export const TREND_BARS = ohlcLegs(11, [
  { n: 20, drift: -0.62, vol: 0.9 },
  { n: 26, drift: 0.78, vol: 1.05 },
]);

/**
 * Swings, then a sharp slide into oversold: the shape the thermometer is
 * about. Sixty bars, so the index has a full window behind it before the
 * first bar a chart draws.
 */
export const SWING_BARS = ohlcLegs(29, [
  { n: 14, drift: 0.5, vol: 0.9 },
  { n: 12, drift: -0.62, vol: 1 },
  { n: 14, drift: 0.58, vol: 0.95 },
  { n: 10, drift: -0.45, vol: 1.1 },
  { n: 10, drift: -0.35, vol: 1.3 },
]);
