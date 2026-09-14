/**
 * Strategy #2 — MA Cross.
 *
 * A fast average crossing a slow one names a side for a few minutes. The
 * signal is computed on the platform from closed bars and shared by everyone;
 * the tap is the user's, and both keys stay live — taking the other side is
 * allowed, it is just not what the strategy says.
 */

import { StrategyScreen } from '@/strategy/screen';

export default function MACrossScreen() {
  return <StrategyScreen id="ma-cross" />;
}
