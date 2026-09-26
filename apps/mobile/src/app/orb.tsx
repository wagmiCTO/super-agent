/**
 * Strategy #5 — Open Range.
 *
 * Three times a day the market wakes up: the daily open, London, New York.
 * The first quarter hour sets a range; the first bar after it to close
 * outside names the side, once per session. Most of the day the screen
 * waits for the next open, and says when it is.
 */

import { StrategyScreen } from '@/strategy/screen';

export default function ORBScreen() {
  return <StrategyScreen id="orb" />;
}
