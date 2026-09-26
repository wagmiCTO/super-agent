/**
 * Strategy #4 — Turtles.
 *
 * The channel between the highest high and the lowest low of the last
 * twenty bars. A bar that closes above the channel names Up, one that closes
 * below it names Down: the Turtles' entry, on the chart's own bars. A trend
 * breaks out again and again; a range never does.
 */

import { StrategyScreen } from '@/strategy/screen';

export default function DonchianScreen() {
  return <StrategyScreen id="donchian" />;
}
