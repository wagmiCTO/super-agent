/**
 * What the account is worth right now.
 *
 * The venue reports free collateral and what is locked under open positions
 * as two numbers, and values the positions separately. A balance that drops
 * by the margin the moment a position opens reads as money gone, which it is
 * not: the account is worth what it holds plus what the open positions are
 * worth at this moment.
 */
import type { State } from '@/api/client';

export function equity(state: State): number {
  // The venue takes a position's margin out of the free balance and reports
  // it on the position as its collateral; `locked` is what resting orders
  // hold, nothing else. So the account is worth the free balance, plus every
  // position's collateral, plus what each position is worth right now.
  const held = Number(state.account.balance) + Number(state.account.locked);
  const inPositions = state.positions.reduce((sum, p) => sum + Number(p.collateral) + Number(p.unrealized_pnl), 0);
  return held + inPositions;
}
