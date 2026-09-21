/**
 * Everything closed — what the red button did, from the platform's own
 * answer: what each strategy's position made or lost, summed, and the fact
 * that nothing is open now. The kill switch does not judge.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { STRATEGY_NAMES } from '@/config';
import { Button } from '@/ui/button';
import { Card, Row, Screen } from '@/ui/surface';
import { Text, money } from '@/ui/text';
import { useBottom, useTop } from '@/ui/inset';
import { useTheme } from '@/theme';

type Result = { closed: number; results: { strategy: string; symbol: string; closed: boolean; error?: string; pnl?: string }[] };

function parse(raw: unknown): Result {
  try {
    const r = JSON.parse(typeof raw === 'string' ? raw : '') as Result;
    return { closed: Number(r.closed) || 0, results: Array.isArray(r.results) ? r.results : [] };
  } catch {
    return { closed: 0, results: [] };
  }
}

export default function ClosedScreen() {
  const theme = useTheme();
  const top = useTop(16);
  const bottom = useBottom(theme.space.s6);
  const { r } = useLocalSearchParams<{ r?: string }>();
  const res = parse(r);
  const rows = res.results.filter((x) => x.closed);
  const failed = res.results.filter((x) => !x.closed);
  const pnl = rows.reduce((sum, x) => sum + (Number(x.pnl) || 0), 0);

  return (
    <Screen testID="closed">
      <View style={{ flex: 1, paddingTop: top, paddingBottom: bottom, justifyContent: 'space-between' }}>
        <View style={{ gap: theme.space.s4 }}>
          <Text variant="caps" style={{ color: theme.color.text2 }}>Everything closed</Text>
          <View>
            <Text variant="h1" style={{ fontSize: theme.type.t3xl }}>{pnl >= 0 ? 'You made' : 'You lost'}</Text>
            <Text variant="hero" signOf={pnl} testID="closed-pnl">{money(pnl)}</Text>
            <Text variant="small" style={{ fontSize: theme.type.tMd, marginTop: theme.space.s2 }}>
              {`AUSD · ${res.closed} ${res.closed === 1 ? 'position' : 'positions'} closed at market`}
            </Text>
          </View>
          <Card>
            {rows.map((x) => (
              <Row key={`${x.strategy}-${x.symbol}`} label={`${STRATEGY_NAMES[x.strategy] ?? x.strategy} · ${x.symbol}`} value={money(Number(x.pnl) || 0)} tone={Number(x.pnl) || 0} />
            ))}
            {failed.map((x) => (
              <Row key={`f-${x.strategy}-${x.symbol}`} label={`${STRATEGY_NAMES[x.strategy] ?? x.strategy} · ${x.symbol}`} value={x.error ?? 'not closed'} />
            ))}
            <Row label="Nothing open now" value="0 AUSD at risk" />
          </Card>
          <Text variant="body">The kill switch does not judge. Nothing is open, and the day&apos;s budget is what it was.</Text>
        </View>
        <Button testID="closed-back" title="Back to lobby" onPress={() => router.replace('/')} />
      </View>
    </Screen>
  );
}
