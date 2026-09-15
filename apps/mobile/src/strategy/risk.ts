/**
 * The number behind the dial in the header.
 *
 * What the day can still cost, against what the day is allowed to cost:
 * everything the open positions can still lose, plus what has already been
 * lost today, over the daily budget. Green while the day is quiet, red when
 * the budget is nearly gone.
 *
 * Read off the state the screen already polls, so the dial costs no request
 * of its own.
 */

import type { State } from '@/api/client';

export function riskPercent(state: State | null): number {
  if (!state) return 0;
  const budget = Number(state.limits.daily_loss);
  if (!Number.isFinite(budget) || budget <= 0) return 0;

  // A position with a stop can lose what the stop gives up; one without can
  // lose its whole collateral, and saying so is the point of the dial.
  const atStake = state.positions.reduce((total, p) => {
    const stop = p.stop_pnl !== undefined ? Math.abs(Number(p.stop_pnl)) : Number(p.collateral);
    return total + (Number.isFinite(stop) ? stop : 0);
  }, 0);

  const spent = Math.abs(Number(state.risk.daily_loss)) || 0;
  return Math.min(100, Math.round(((atStake + spent) / budget) * 100));
}

/**
 * The word the risk screen puts on the day. The cut-offs are the design's:
 * a quiet day is calm, a day with something in play is warm, and past 60 of
 * the budget it is hot.
 */
export function riskLevel(percent: number): 'Calm' | 'Warm' | 'Hot' {
  if (percent <= 0) return 'Calm';
  return percent < 60 ? 'Warm' : 'Hot';
}
