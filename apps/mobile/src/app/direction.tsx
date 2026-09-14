/**
 * Strategy #1 — Direction.
 *
 * Up or down, in the next fifteen minutes. There is no signal to wait for:
 * the call is entirely the user's, so both keys stay filled and the screen
 * asks its question instead of naming a side.
 */

import { StrategyScreen } from '@/strategy/screen';

export default function DirectionScreen() {
  return <StrategyScreen id="direction" />;
}
