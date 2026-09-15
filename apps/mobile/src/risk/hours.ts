/**
 * Today, hour by hour: how much was in play.
 *
 * The platform keeps no time series, so the bars are built here from what
 * it does keep — today's round trips with their open and close times, and
 * the positions open right now. "In play" is the notional, not the risk:
 * the stop is not recorded on a closed trade, and a bar that guessed would
 * be worse than one that says what it measures.
 */

import type { RiskReport, Trade } from '@/api/client';

type OpenNow = RiskReport['open'][number];

/** Twenty-four values, 0..100: each hour's peak notional against the day's. */
export function hoursInPlay(trades: Trade[], open: OpenNow[], now: Date): number[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const dayStart = start.getTime();
  const hourMs = 3_600_000;
  const inPlay = new Array<number>(24).fill(0);

  const add = (fromMs: number, toMs: number, notional: number) => {
    if (!Number.isFinite(notional) || notional <= 0) return;
    const from = Math.max(fromMs, dayStart);
    const to = Math.min(toMs, now.getTime());
    if (to <= from) return;
    const first = Math.floor((from - dayStart) / hourMs);
    const last = Math.min(23, Math.floor((to - 1 - dayStart) / hourMs));
    for (let h = Math.max(0, first); h <= last; h++) inPlay[h] += notional;
  };

  for (const t of trades) {
    if (!t.closed_at) continue;
    add(new Date(t.opened_at).getTime(), new Date(t.closed_at).getTime(), Number(t.size) * Number(t.entry_price));
  }
  for (const p of open) {
    if (!p.opened_at) continue;
    add(new Date(p.opened_at).getTime(), now.getTime(), Number(p.notional));
  }

  const peak = Math.max(...inPlay);
  if (peak <= 0) return inPlay;
  return inPlay.map((v) => Math.round((v / peak) * 100));
}
