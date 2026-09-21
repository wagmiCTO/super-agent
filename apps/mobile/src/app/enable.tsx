/**
 * A6 — opening the account on the exchange.
 *
 * Three things have to happen before a tap can reach the venue, and none of
 * them is the user's problem:
 *
 *   1. a key for the strategy, so the platform can sign orders for this wallet
 *   2. the venue's testnet funding, which arrives on first sign-in
 *   3. three transactions from the wallet — approve the collateral, create the
 *      account, let the strategies forward orders
 *
 * The screen names them in plain words and runs them as one press. The bar for
 * the step it is on fills within itself: three lamps that only switch look
 * stuck, and this genuinely takes a minute or two.
 */

import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { useAccount } from '@/account/useAccount';
import { formatCollateral, formatNative } from '@/exchange/activate';
import { useActivation } from '@/exchange/useActivation';
import { useExchangeKey } from '@/exchange/useExchangeKey';
import { useTrading } from '@/trading/useTrading';
import { Button } from '@/ui/button';
import { Card, Progress, Screen } from '@/ui/surface';
import { Text } from '@/ui/text';
import { useBottom, useTop } from '@/ui/inset';
import { useTheme } from '@/theme';

/** What the user is waiting for, in the order it happens. */
const STEPS = ['Signing in to the exchange', 'Test money arriving', 'Opening your account'] as const;

export default function EnableScreen() {
  const theme = useTheme();
  const top = useTop(32);
  const bottom = useBottom(theme.space.s6);
  const account = useAccount();
  const wallet = account.state.status === 'unlocked' ? account.state.wallet : null;
  const keys = account.state.status === 'unlocked' ? account.state.keys : null;

  const t = useTrading('MON', 'direction');
  // Only an answer asked in this wallet's name says anything about it. The
  // first poll can leave before the account layer has named the wallet, and
  // the platform then answers for its own account, which is always open:
  // read as the user's, that sent the screen to the lobby, and the gate sent
  // it straight back here, for ever.
  const heard = wallet !== null && t.state !== null && t.stateFor?.toLowerCase() === wallet.address.toLowerCase();
  const status = heard ? t.state!.account.status : null;
  const pending = status === 'no_exchange_account' || status === 'forwarding_disabled' ? status : null;

  const key = useExchangeKey(keys);
  const { network, funding, funded, progress, busy, error, activate } = useActivation(wallet, pending);

  const hasKey = key.state.status === 'enabled';
  // Which of the three the screen is on. Without a key nothing else can even
  // be asked; with a key but no funds the venue has not credited the wallet
  // yet; with funds the transactions can run.
  const at = !hasKey ? 0 : funded ? 2 : 1;
  const running = key.busy || busy || progress !== null;

  // Activated: the design goes straight to the lobby from here.
  const done = hasKey && heard && !pending;
  useEffect(() => {
    if (done) router.replace('/');
  }, [done]);

  // One press, then the screen carries on by itself: waiting for the venue to
  // credit the wallet is not a decision, so it is not a second button.
  const [started, setStarted] = useState(false);
  const activating = useRef(false);
  useEffect(() => {
    if (!started || !hasKey || !funded || running || done || activating.current) return;
    activating.current = true;
    void activate();
  }, [started, hasKey, funded, running, done, activate]);

  const failed = key.error ?? error;

  const start = () => {
    setStarted(true);
    // A second press is a retry, so the one-shot latch has to let go —
    // otherwise a failed activation leaves a live button that does nothing.
    activating.current = false;
    // The retry starts here rather than being left to the effect above: both
    // hooks drop their error the moment they start, so the press reaches the
    // loader within one render, with no live frame in between. Left to the
    // effect, a retry after a failed activation would not restart at all —
    // nothing in the render changes, so the effect would not run again.
    if (!hasKey) void key.enable();
    else if (funded && !running && !done) {
      activating.current = true;
      void activate();
    }
  };

  // Between the key and the funds, and again between the last transaction and
  // the lobby, no hook is busy — the screen is simply waiting on the venue.
  // The button does not flicker awake in those gaps: from the press until the
  // account exists it is one loader, and only a failure gives it back.
  const working = started && failed === null;

  return (
    <Screen>
      <View style={{ flex: 1, paddingTop: top, paddingBottom: bottom, gap: theme.space.s5 }}>
        <View style={{ gap: theme.space.s3 }}>
          <Text variant="h1">Open your account</Text>
          <Text variant="body">
            One tap. The exchange opens your account and gives you practice money to trade with. About a minute.
          </Text>
        </View>

        {started ? (
          <Card testID="enable-progress">
            <View style={{ flexDirection: 'row', gap: theme.space.s2 }}>
              {STEPS.map((step, i) => (
                <Progress key={step} value={i < at ? 100 : i === at ? 55 : 0} />
              ))}
            </View>
            <View style={{ gap: theme.space.s2 }}>
              {STEPS.map((step, i) => (
                <Step
                  key={step}
                  label={i === 1 && network && funding ? `Test money arriving: ${formatCollateral(network, funding.collateral)} ${network.collateral_symbol}` : step}
                  state={i < at ? 'done' : i === at ? 'now' : 'todo'}
                />
              ))}
            </View>
          </Card>
        ) : null}

        {failed ? (
          <Card testID="enable-error" style={{ backgroundColor: theme.color.dangerSoft, borderColor: theme.color.danger }}>
            <Text variant="body" style={{ fontSize: theme.type.tSm, color: theme.color.danger }}>{inPlainWords(failed)}</Text>
          </Card>
        ) : null}

        {network && funding ? (
          <Card testID="enable-funding">
            <Text variant="caps">In your wallet</Text>
            <Text variant="num" style={{ fontSize: theme.type.tSm }}>
              {`${formatCollateral(network, funding.collateral)} ${network.collateral_symbol} · ${formatNative(funding.native)} for gas`}
            </Text>
          </Card>
        ) : null}

        <View style={{ flex: 1 }} />

        <Button
          testID="enable-start"
          title={working ? 'Working…' : failed ? 'Try again' : 'Open account'}
          busy={working}
          disabled={working}
          onPress={start}
        />
      </View>
    </Screen>
  );
}

/**
 * The same venue failures, said for a screen that is opening an account.
 *
 * The shared message is written for the trading screen and starts "refused the
 * order" — there is no order here. The one worth naming outright is the edge
 * rate limit: it says nothing is wrong, only that too many accounts were
 * opened from this machine just now, and waiting is the whole fix.
 */
function inPlainWords(message: string): string {
  const text = message.replace(/^The exchange refused the order: /, '');
  if (/\b429\b|error code: 1015/.test(text)) {
    return 'The exchange is limiting how many accounts open at once. Wait a minute, then press again.';
  }
  return `The exchange refused: ${text}`;
}

function Step({ label, state }: { label: string; state: 'done' | 'now' | 'todo' }) {
  const theme = useTheme();
  const colour = state === 'now' ? theme.color.ink : state === 'done' ? theme.color.muted : theme.color.dim;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.s2 }}>
      <View style={{ width: 14, alignItems: 'center' }}>
        {state === 'done' ? (
          <Text variant="small" style={{ color: theme.color.accent }}>✓</Text>
        ) : state === 'now' ? (
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.color.accent }} />
        ) : (
          <Text variant="small" style={{ color: theme.color.dim }}>○</Text>
        )}
      </View>
      <Text variant="small" style={{ flex: 1, color: colour }}>{label}</Text>
    </View>
  );
}
