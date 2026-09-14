/**
 * Strategy #3 — RSI Bounce.
 *
 * The crowd overdoes it: under the oversold line the sellers have gone too
 * far and the signal names Up, over the overbought line the other way round.
 * Zones come once or twice a day, so most visits find the screen quiet.
 */

import { StrategyScreen } from '@/strategy/screen';

export default function RSIScreen() {
  return <StrategyScreen id="rsi" />;
}
