/**
 * Strategy #1 — Direction.
 *
 * Asset → up or down → amount → horizon → one number. The whole screen
 * exists to make the round trip legible: what it costs to enter, and what
 * the position is worth right now. The tap is the signal; the horizon is
 * the exit the platform enforces. Every order goes through the platform,
 * which puts it through the policy engine before the venue; a refusal comes
 * back with the limit that was hit and is shown in words.
 */
import { Link } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAccount } from '@/account/useAccount';
import { AccountSection } from '@/components/account';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  CloseButton,
  DirectionButton,
  LimitsFooter,
  NoticeBox,
  PositionCard,
  PresetRow,
  ScreenHeader,
  styles,
} from '@/components/trading';
import { DEFAULT_SYMBOL, HORIZON_PRESETS, horizonSeconds, NOTIONAL_PRESETS, type Horizon } from '@/config';
import { useTrading } from '@/trading/useTrading';

type Notional = (typeof NOTIONAL_PRESETS)[number];

export default function DirectionScreen() {
  const account = useAccount();
  const t = useTrading(DEFAULT_SYMBOL, 'direction');
  const [notional, setNotional] = useState<Notional>('20');
  const [horizon, setHorizon] = useState<Horizon>('15m');

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <ScreenHeader title={`DIRECTION · ${DEFAULT_SYMBOL}`} state={t.state} offline={t.offline} />

          <AccountSection account={account} state={t.state} onChange={t.refresh} />

          <PositionCard position={t.position} market={t.market} notional={notional} />

          {t.position ? (
            <CloseButton busy={t.busy === 'close'} disabled={t.busy !== null} onPress={() => void t.close()} />
          ) : (
            <>
              <PresetRow label="Amount" options={NOTIONAL_PRESETS} value={notional} onChange={setNotional} />
              <PresetRow label="Horizon" options={HORIZON_PRESETS} value={horizon} onChange={setHorizon} />
              <View style={styles.directions}>
                <DirectionButton
                  label="Up"
                  color="#16a34a"
                  busy={t.busy === 'up'}
                  disabled={t.busy !== null}
                  onPress={() => void t.open('long', notional, horizonSeconds(horizon))}
                />
                <DirectionButton
                  label="Down"
                  color="#dc2626"
                  busy={t.busy === 'down'}
                  disabled={t.busy !== null}
                  onPress={() => void t.open('short', notional, horizonSeconds(horizon))}
                />
              </View>
            </>
          )}

          <NoticeBox notice={t.notice} />
          <LimitsFooter state={t.state} />

          <Link href="/" style={styles.link} accessibilityRole="link">
            <ThemedText type="smallBold" themeColor="textSecondary">
              ← Lobby
            </ThemedText>
          </Link>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}
