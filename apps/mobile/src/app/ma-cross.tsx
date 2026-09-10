/**
 * Strategy #2 — MA Cross.
 *
 * A minute chart with the price and the slow average. When the fast average
 * crosses the slow one, the screen lights up and offers an entry in the
 * cross's direction for a few minutes. The signal is computed on the
 * platform from closed bars and shared by everyone; the tap is the user's.
 * The exit is the same horizon Direction uses.
 */
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAccount } from '@/account/useAccount';
import { api, type MACrossSignal, type Position, type Trade } from '@/api/client';
import { AccountSection } from '@/components/account';
import { TVChart } from '@/components/TVChart';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  CloseButton,
  DirectionButton,
  HistoryCard,
  LimitsFooter,
  NoticeBox,
  PositionCard,
  PresetRow,
  ScreenHeader,
  styles,
  useCountdown,
} from '@/components/trading';
import { DEFAULT_SYMBOL, HORIZON_PRESETS, horizonSeconds, NOTIONAL_PRESETS, SIGNAL_POLL_MS, type Horizon } from '@/config';
import { useTheme } from '@/hooks/use-theme';
import { useTrading } from '@/trading/useTrading';

type Notional = (typeof NOTIONAL_PRESETS)[number];
const CHART_MODES = ['Candles', 'Line'] as const;
type ChartMode = (typeof CHART_MODES)[number];

const UP = '#16a34a';
const DOWN = '#dc2626';

export default function MACrossScreen() {
  const account = useAccount();
  const t = useTrading(DEFAULT_SYMBOL, 'ma-cross');
  const signal = useSignal(DEFAULT_SYMBOL);
  const [notional, setNotional] = useState<Notional>('20');
  const [horizon, setHorizon] = useState<Horizon>('15m');
  const [mode, setMode] = useState<ChartMode>('Candles');
  const window = signal?.window ?? null;
  const windowLeft = useCountdown(window?.expires_at ?? null);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <ScreenHeader title={`MA CROSS · ${DEFAULT_SYMBOL}`} state={t.state} offline={t.offline} />

          <AccountSection account={account} state={t.state} onChange={t.refresh} />

          <SignalCard
            signal={signal}
            windowLeft={windowLeft}
            mode={mode}
            onMode={setMode}
            trades={t.trades}
            position={t.position}
          />

          <PositionCard position={t.position} market={t.market} notional={notional} />

          {t.position ? (
            <CloseButton busy={t.busy === 'close'} disabled={t.busy !== null} onPress={() => void t.close()} />
          ) : window ? (
            <>
              <PresetRow label="Amount" options={NOTIONAL_PRESETS} value={notional} onChange={setNotional} />
              <PresetRow label="Horizon" options={HORIZON_PRESETS} value={horizon} onChange={setHorizon} />
              <View style={styles.directions}>
                {/* Only the cross's direction is offered: that is the strategy. */}
                <DirectionButton
                  label={window.side === 'long' ? 'Up' : 'Down'}
                  color={window.side === 'long' ? UP : DOWN}
                  busy={t.busy === 'up' || t.busy === 'down'}
                  disabled={t.busy !== null}
                  onPress={() => void t.open(window.side, notional, horizonSeconds(horizon))}
                />
              </View>
            </>
          ) : (
            <ThemedText type="small" themeColor="textSecondary" style={styles.footer} testID="signal-waiting">
              {signal?.ready ? 'Waiting for the next cross — the screen lights up when it comes' : 'Warming up the signal…'}
            </ThemedText>
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

/** Polls the platform's signal for a market. */
function useSignal(symbol: string): MACrossSignal | null {
  const [signal, setSignal] = useState<MACrossSignal | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () =>
      api
        .maCross(symbol)
        .then((s) => alive && setSignal(s))
        .catch(() => undefined);
    void read();
    const id = setInterval(read, SIGNAL_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [symbol]);
  return signal;
}

/**
 * The chart and the state of the signal. Price as a thin line, the slow
 * average as the one line that matters, the whole card tinted by the trend
 * and lit while a window is open.
 */
function SignalCard({
  signal,
  windowLeft,
  mode,
  onMode,
  trades,
  position,
}: {
  signal: MACrossSignal | null;
  windowLeft: string | null;
  mode: ChartMode;
  onMode: (m: ChartMode) => void;
  trades: Trade[];
  position: Position | null;
}) {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const trendColor = signal?.trend === 'up' ? UP : signal?.trend === 'down' ? DOWN : theme.textSecondary;
  const lit = Boolean(signal?.window);
  return (
    <View
      testID="signal-card"
      style={[
        styles.card,
        { backgroundColor: theme.backgroundElement, alignItems: 'stretch', borderWidth: 2, borderColor: lit ? trendColor : 'transparent' },
      ]}>
      <View style={styles.header}>
        <ThemedText type="small" themeColor="textSecondary" testID="signal-trend">
          {signal ? `${signal.fast}/${signal.slow} · 1m · trend ${signal.trend}` : 'Loading signal…'}
        </ThemedText>
        {signal?.window ? (
          <ThemedText type="smallBold" style={{ color: trendColor }} testID="signal-window">
            {signal.window.side === 'long' ? 'Up' : 'Down'} window · {windowLeft ?? ''}
          </ThemedText>
        ) : signal?.last_cross ? (
          <ThemedText type="small" themeColor="textSecondary" testID="signal-last-cross">
            last cross {signal.last_cross.side === 'long' ? 'up' : 'down'} · {timeOfDay(signal.last_cross.at)}
          </ThemedText>
        ) : null}
      </View>
      <TVChart
        symbol={DEFAULT_SYMBOL}
        theme={dark ? 'dark' : 'light'}
        background={theme.backgroundElement}
        chartType={mode === 'Line' ? 'line' : 'candles'}
        trend={signal?.trend ?? 'flat'}
        trades={trades}
        position={position}
        height={280}
      />
      <PresetRow label="Chart" options={CHART_MODES} value={mode} onChange={onMode} />
    </View>
  );
}

function timeOfDay(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
