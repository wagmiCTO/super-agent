/**
 * The strategy of the day: which of the three fits the tape right now, in
 * one sentence a reader can act on. Read off the same signals the screens
 * show — the fifteen-minute chart's RSI and averages — so it is never a
 * claim the screen contradicts. When the tape says nothing, the day picks
 * for itself: the same choice all day, a different one tomorrow, so the
 * three strategies get met in turn rather than the first one always.
 */

import type { StrategyId } from '@/strategy/useSignal';

export type TodayInput = {
  /** The calendar day, YYYY-MM-DD, and the market: the seed of a quiet day's pick. */
  day: string;
  symbol: string;
  /** RSI on the 15-minute chart, when the platform has one. */
  rsi?: number;
  /** The averages' trend on the 15-minute chart, and how old the last cross is. */
  trend?: 'up' | 'down' | 'flat';
  lastCrossMinutes?: number;
};

export type Today = { id: StrategyId; reason: string };

export function strategyOfTheDay(t: TodayInput): Today {
  if (t.rsi !== undefined && Number.isFinite(t.rsi) && (t.rsi >= 65 || t.rsi <= 35)) {
    const side = t.rsi >= 65 ? 'buying' : 'selling';
    return { id: 'rsi', reason: `RSI on the 15-minute chart is ${Math.round(t.rsi)}: the crowd has overdone the ${side}, and a stretched crowd snaps back. RSI Bounce is built for exactly this.` };
  }
  if (t.trend && t.trend !== 'flat' && t.lastCrossMinutes !== undefined && t.lastCrossMinutes <= 180) {
    const ago = t.lastCrossMinutes < 60 ? `${Math.max(1, Math.round(t.lastCrossMinutes))} min ago` : `${(t.lastCrossMinutes / 60).toFixed(1)} h ago`;
    return { id: 'ma-cross', reason: `The averages crossed ${t.trend} ${ago} on the 15-minute chart and the trend is holding: a trend day, and trend days pay crosses. MA Cross fits today.` };
  }
  const picks: Today[] = [
    { id: 'direction', reason: 'Nothing is stretched and nothing has crossed: a quiet tape is a Direction day. Pick a side on a turn, keep the stop, let the timer close it.' },
    { id: 'ma-cross', reason: 'Quiet so far, no cross yet. The first cross of a quiet day tends to run: sit on MA Cross and let it name the side.' },
    { id: 'rsi', reason: 'Quiet so far, the index mid-range. Days like this end in a stretch: RSI Bounce waits well, and the entry is sharp when it comes.' },
  ];
  return picks[hash(`${t.day}:${t.symbol.toUpperCase()}`) % picks.length];
}

/** A small stable hash: the same string, the same number, on every device. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** Today, as the sheet keys its once-a-day showing. */
export function todayKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
