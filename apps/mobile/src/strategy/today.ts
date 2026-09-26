/**
 * The strategy of the day: which of the strategies fits the tape right
 * now, in one sentence a reader can act on. Read off the same signals the
 * screens show — the fifteen-minute chart's RSI, averages, channel and
 * opening range — so it is never a claim the screen contradicts. When the
 * tape says nothing, the day picks for itself: the same choice all day, a
 * different one tomorrow, so the strategies get met in turn rather than
 * the first one always.
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
  /** How old the last close out of the 20-bar channel is, on the 15-minute chart. */
  lastBreakMinutes?: number;
  /** Where the opening range's session is, and how far the next open is. */
  orbPhase?: 'forming' | 'watching' | 'broken' | 'closed';
  nextOpenMinutes?: number;
};

export type Today = { id: StrategyId; reason: string };

export function strategyOfTheDay(t: TodayInput): Today {
  if (t.rsi !== undefined && Number.isFinite(t.rsi) && (t.rsi >= 65 || t.rsi <= 35)) {
    const side = t.rsi >= 65 ? 'buying' : 'selling';
    return { id: 'rsi', reason: `RSI on the 15-minute chart is ${Math.round(t.rsi)}: the crowd has overdone the ${side}, and a stretched crowd snaps back. RSI Bounce is built for exactly this.` };
  }
  if (t.orbPhase === 'forming' || t.orbPhase === 'watching') {
    return { id: 'orb', reason: t.orbPhase === 'forming' ? 'A session has just opened and its range is being set right now. The first close outside it is the day\'s first decided move: Open Range is live.' : 'A session opened and its range is set; the market has not left it yet. The first close outside it is the entry, and it is being watched now. Open Range fits this hour.' };
  }
  if (t.lastBreakMinutes !== undefined && t.lastBreakMinutes <= 120) {
    const ago = t.lastBreakMinutes < 60 ? `${Math.max(1, Math.round(t.lastBreakMinutes))} min ago` : `${(t.lastBreakMinutes / 60).toFixed(1)} h ago`;
    return { id: 'donchian', reason: `The price closed out of its 20-bar channel ${ago} on the 15-minute chart: the market has left its range, and a trend that has started breaks out again. Turtles fits today.` };
  }
  if (t.trend && t.trend !== 'flat' && t.lastCrossMinutes !== undefined && t.lastCrossMinutes <= 180) {
    const ago = t.lastCrossMinutes < 60 ? `${Math.max(1, Math.round(t.lastCrossMinutes))} min ago` : `${(t.lastCrossMinutes / 60).toFixed(1)} h ago`;
    return { id: 'ma-cross', reason: `The averages crossed ${t.trend} ${ago} on the 15-minute chart and the trend is holding: a trend day, and trend days pay crosses. MA Cross fits today.` };
  }
  if (t.nextOpenMinutes !== undefined && t.nextOpenMinutes > 0 && t.nextOpenMinutes <= 45) {
    return { id: 'orb', reason: `A session opens in ${Math.max(1, Math.round(t.nextOpenMinutes))} minutes. Its first quarter hour sets a range and the first close outside it is the entry: be on Open Range when it does.` };
  }
  const picks: Today[] = [
    { id: 'direction', reason: 'Nothing is stretched and nothing has crossed: a quiet tape is a Direction day. Pick a side on a turn, keep the stop, let the timer close it.' },
    { id: 'ma-cross', reason: 'Quiet so far, no cross yet. The first cross of a quiet day tends to run: sit on MA Cross and let it name the side.' },
    { id: 'rsi', reason: 'Quiet so far, the index mid-range. Days like this end in a stretch: RSI Bounce waits well, and the entry is sharp when it comes.' },
    { id: 'donchian', reason: 'Quiet so far, the price inside its channel. A quiet range is what a breakout comes out of: sit on Turtles and let the close outside name the side.' },
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
