/**
 * Withdraw — the design's screen, and the stack it needs, are not built yet.
 *
 * The money is the wallet's own: it sits in the wallet's exchange account,
 * and nothing here custodies it. Taking it out is a route of its own —
 * amount, destination, the bridge's quote — and until that exists the button
 * on the account screen leads here rather than nowhere.
 */
import { StubScreen } from '@/ui/stub';

export default function WithdrawScreen() {
  return <StubScreen title="Withdraw" badge="COMING SOON" testID="withdraw-screen" />;
}
