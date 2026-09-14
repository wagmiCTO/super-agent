/**
 * A6 — opening the account on the exchange.
 *
 * Three transactions the user did not ask about and should not have to think
 * about: approve the collateral, open the account, let the strategies forward
 * orders. The screen names them in plain words and shows the bar for the step
 * it is on filling within itself, rather than three lamps switching — a wait
 * that only switches looks stuck.
 */

import { router } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

import { useAccount } from '@/account/useAccount';
import { formatCollateral, type ActivationStep } from '@/exchange/activate';
import { useActivation } from '@/exchange/useActivation';
import { useTrading } from '@/trading/useTrading';
import { Button } from '@/ui/button';
import { Card, Progress, Screen } from '@/ui/surface';
import { Text } from '@/ui/text';
import { useTheme } from '@/theme';

const ORDER: ActivationStep[] = ['approve', 'create', 'forward'];

const LABELS: Record<ActivationStep, string> = {
  approve: 'Signing in to the exchange',
  create: 'Opening your account',
  forward: 'Linking the strategies',
};

export default function EnableScreen() {
  const theme = useTheme();
  const account = useAccount();
  const wallet = account.state.status === 'unlocked' ? account.state.wallet : null;
  const t = useTrading('MON', 'direction');
  const pending =
    t.state?.account.status === 'no_exchange_account' || t.state?.account.status === 'forwarding_disabled'
      ? t.state.account.status
      : null;
  const { network, shortfall, funded, progress, busy, error, activate } = useActivation(wallet, pending);

  const done = Boolean(t.state && !pending);
  useEffect(() => {
    if (done) router.replace('/');
  }, [done]);

  const at = progress ? ORDER.indexOf(progress.step) : -1;
  const running = busy || at >= 0;

  return (
    <Screen>
      <View style={{ flex: 1, paddingTop: 72, paddingBottom: theme.space.s6, gap: theme.space.s5 }}>
        <View style={{ gap: theme.space.s3 }}>
          <Text variant="h1">Open your account</Text>
          <Text variant="body">
            {funded
              ? 'One tap. The exchange opens your account and links it to the strategies. About a minute.'
              : 'One tap. The exchange opens your account and gives you practice money. About a minute.'}
          </Text>
        </View>

        {running ? (
          <Card testID="enable-progress">
            <View style={{ flexDirection: 'row', gap: theme.space.s2 }}>
              {ORDER.map((step, i) => (
                <Progress key={step} value={i < at ? 100 : i === at ? 55 : 0} />
              ))}
            </View>
            <View style={{ gap: theme.space.s2 }}>
              {ORDER.map((step, i) => (
                <Step key={step} label={LABELS[step]} state={i < at ? 'done' : i === at ? 'now' : 'todo'} />
              ))}
            </View>
          </Card>
        ) : null}

        {error ? (
          <Card style={{ backgroundColor: theme.color.dangerSoft, borderColor: theme.color.danger }}>
            <Text variant="body" style={{ fontSize: theme.type.tSm, color: theme.color.danger }}>{error}</Text>
          </Card>
        ) : null}

        {network && shortfall && !funded ? (
          <Card testID="enable-shortfall">
            <Text variant="caps">Not enough to open an account</Text>
            <Text variant="body" style={{ fontSize: theme.type.tSm }}>
              {`Send ${formatCollateral(network, shortfall.collateral)} ${network.collateral_symbol} to your address first — Account has the details.`}
            </Text>
          </Card>
        ) : null}

        <View style={{ flex: 1 }} />

        <Button
          testID="enable-start"
          title={running ? 'Working…' : 'Open account'}
          busy={running}
          disabled={running || (network ? !funded : false)}
          onPress={() => void activate()}
        />
      </View>
    </Screen>
  );
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
