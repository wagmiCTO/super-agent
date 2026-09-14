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
import { Link, router } from 'expo-router';
import { ScrollView, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAccount } from '@/account/useAccount';
import { AccountSection } from '@/components/account';
import { ContextCard } from '@/components/context';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  CloseButton,
  DirectionButton,
  HistoryCard,
  LimitsFooter,
  NoticeBox,
  PositionCard,
  ScreenHeader,
  styles,
} from '@/components/trading';
import { DEFAULT_SYMBOL } from '@/config';
import { SettingsChip } from '@/trading/position-form';
import { maxLossFraction, usePositionSettings } from '@/trading/useSettings';
import { TVChart } from '@/components/TVChart';
import { useTheme } from '@/hooks/use-theme';
import { useTrading } from '@/trading/useTrading';

export default function DirectionScreen() {
  const account = useAccount();
  const t = useTrading(DEFAULT_SYMBOL, 'direction');
  // One standard position, set once on its own screen: the tap asks nothing
  // but the direction.
  const { settings } = usePositionSettings();
  const notional = String(settings.size);
  const maxLoss = maxLossFraction(settings);
  const tap = (side: 'long' | 'short') =>
    void t.open(side, notional, settings.horizonMinutes * 60, maxLoss, String(settings.leverage));
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <ScreenHeader title={`DIRECTION · ${DEFAULT_SYMBOL}`} state={t.state} offline={t.offline} locked={t.locked} />

          <AccountSection account={account} state={t.state} onChange={t.refresh} strategy="direction" />

          <View style={[styles.card, { backgroundColor: theme.backgroundElement, alignItems: 'stretch' }]} testID="signal-card">
            <TVChart
              symbol={DEFAULT_SYMBOL}
              theme={dark ? 'dark' : 'light'}
              background={theme.backgroundElement}
              chartType="candles"
              trend={t.position ? (t.position.side === 'long' ? 'up' : 'down') : 'flat'}
              ma={0}
              trades={t.trades}
              position={t.position}
              height={260}
            />
          </View>

          <ContextCard symbol={DEFAULT_SYMBOL} />

          <PositionCard
            position={t.position}
            market={t.market}
            notional={notional}
            stop={maxLoss}
            state={t.state}
            leverage={String(settings.leverage)}
          />

          {t.position ? (
            <CloseButton busy={t.busy === 'close'} disabled={t.busy !== null} onPress={() => void t.close()} />
          ) : (
            <>
              <ThemedText type="small" themeColor="textSecondary" style={styles.risks}>
                {`Where does ${DEFAULT_SYMBOL} go in the next ${settings.horizonMinutes} minutes?`}
              </ThemedText>
              <View style={styles.directions}>
                <DirectionButton
                  label="Up"
                  color="#16a34a"
                  busy={t.busy === 'up'}
                  disabled={t.busy !== null}
                  onPress={() => tap('long')}
                />
                <DirectionButton
                  label="Down"
                  color="#dc2626"
                  busy={t.busy === 'down'}
                  disabled={t.busy !== null}
                  onPress={() => tap('short')}
                />
              </View>
              <SettingsChip onPress={() => router.push('/settings')} />
            </>
          )}

          <NoticeBox notice={t.notice} />
          <HistoryCard trades={t.trades} />
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
