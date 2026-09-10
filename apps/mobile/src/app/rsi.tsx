/**
 * Strategy #3 — RSI Bounce.
 *
 * The counter-trend game. A thermometer shows how hard the crowd has been
 * buying or selling; when a bar closes with the index entering the oversold
 * zone the screen offers an entry up, entering overbought offers an entry
 * down, for a few minutes. Long waits, rare sharp entries — the opposite
 * rhythm of MA Cross, on purpose.
 */
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAccount } from '@/account/useAccount';
import { api, type RSISignal } from '@/api/client';
import { AccountSection } from '@/components/account';
import { ContextCard } from '@/components/context';
import { trim } from '@/components/format';
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
import { TVChart } from '@/components/TVChart';
import { DEFAULT_SYMBOL, HORIZON_PRESETS, horizonSeconds, NOTIONAL_PRESETS, SIGNAL_POLL_MS, type Horizon } from '@/config';
import { useTheme } from '@/hooks/use-theme';
import { useTrading } from '@/trading/useTrading';

type Notional = (typeof NOTIONAL_PRESETS)[number];
const CHART_MODES = ['Candles', 'Line'] as const;
type ChartMode = (typeof CHART_MODES)[number];

const UP = '#16a34a';
const DOWN = '#dc2626';

export default function RSIScreen() {
  const account = useAccount();
  const t = useTrading(DEFAULT_SYMBOL, 'rsi');
  const signal = useRSI(DEFAULT_SYMBOL);
  const [notional, setNotional] = useState<Notional>('20');
  const [horizon, setHorizon] = useState<Horizon>('15m');
  const [mode, setMode] = useState<ChartMode>('Candles');
  const window = signal?.window ?? null;
  const windowLeft = useCountdown(window?.expires_at ?? null);
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const lit = Boolean(window);
  const sideColor = window?.side === 'long' ? UP : DOWN;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <ScreenHeader title={`RSI BOUNCE · ${DEFAULT_SYMBOL}`} state={t.state} offline={t.offline} locked={t.locked} />

          <AccountSection account={account} state={t.state} onChange={t.refresh} strategy="rsi" />

          <View
            testID="signal-card"
            style={[
              styles.card,
              { backgroundColor: theme.backgroundElement, alignItems: 'stretch', borderWidth: 2, borderColor: lit ? sideColor : 'transparent' },
            ]}>
            <View style={styles.header}>
              <ThemedText type="small" themeColor="textSecondary" testID="signal-rsi">
                {signal?.ready ? `RSI(${signal.length}) · 1m · zones ${trim(signal.oversold)} / ${trim(signal.overbought)}` : 'Warming up the signal…'}
              </ThemedText>
              {window ? (
                <ThemedText type="smallBold" style={{ color: sideColor }} testID="signal-window">
                  {window.side === 'long' ? 'Oversold' : 'Overbought'} · {windowLeft ?? ''}
                </ThemedText>
              ) : signal?.last_cross ? (
                <ThemedText type="small" themeColor="textSecondary" testID="signal-last-cross">
                  last {signal.last_cross.side === 'long' ? 'oversold' : 'overbought'} · {timeOfDay(signal.last_cross.at)}
                </ThemedText>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <TVChart
                  symbol={DEFAULT_SYMBOL}
                  theme={dark ? 'dark' : 'light'}
                  background={theme.backgroundElement}
                  chartType={mode === 'Line' ? 'line' : 'candles'}
                  trend={window ? (window.side === 'long' ? 'up' : 'down') : 'flat'}
                  ma={0}
                  study="rsi"
                  trades={t.trades}
                  position={t.position}
                  height={320}
                />
              </View>
              <Thermometer value={signal?.ready ? Number(signal.value) : null} low={Number(signal?.oversold ?? 30)} high={Number(signal?.overbought ?? 70)} />
            </View>
            <PresetRow label="Chart" options={CHART_MODES} value={mode} onChange={setMode} />
          </View>

          <ContextCard symbol={DEFAULT_SYMBOL} />

          <PositionCard position={t.position} market={t.market} notional={notional} />

          {t.position ? (
            <CloseButton busy={t.busy === 'close'} disabled={t.busy !== null} onPress={() => void t.close()} />
          ) : window ? (
            <>
              <PresetRow label="Amount" options={NOTIONAL_PRESETS} value={notional} onChange={setNotional} />
              <PresetRow label="Horizon" options={HORIZON_PRESETS} value={horizon} onChange={setHorizon} />
              <View style={styles.directions}>
                <DirectionButton
                  label={window.side === 'long' ? 'Up' : 'Down'}
                  color={sideColor}
                  busy={t.busy === 'up' || t.busy === 'down'}
                  disabled={t.busy !== null}
                  onPress={() => void t.open(window.side, notional, horizonSeconds(horizon))}
                />
              </View>
            </>
          ) : (
            <ThemedText type="small" themeColor="textSecondary" style={styles.footer} testID="signal-waiting">
              {signal?.ready ? 'Waiting for the crowd to overdo it — the screen lights up when the RSI enters a zone' : 'Warming up the signal…'}
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

/** The index as a vertical bar: zones at the ends, the value as a marker. */
function Thermometer({ value, low, high }: { value: number | null; low: number; high: number }) {
  const theme = useTheme();
  const color = value === null ? theme.textSecondary : value <= low ? UP : value >= high ? DOWN : theme.text;
  return (
    <View style={{ width: 44, alignItems: 'center', gap: 4 }} testID="rsi-thermometer">
      <ThemedText type="small" themeColor="textSecondary">
        {high}
      </ThemedText>
      <View style={{ flex: 1, width: 14, borderRadius: 7, backgroundColor: theme.backgroundSelected, overflow: 'hidden', justifyContent: 'flex-end' }}>
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: `${100 - high}%`, backgroundColor: 'rgba(220,38,38,0.25)' }} />
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${low}%`, backgroundColor: 'rgba(22,163,74,0.25)' }} />
        {value !== null ? (
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: `${Math.max(0, Math.min(100, value))}%`, height: 3, backgroundColor: color }} />
        ) : null}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {low}
      </ThemedText>
      <ThemedText type="smallBold" style={{ color }} testID="rsi-value">
        {value === null ? '—' : value.toFixed(0)}
      </ThemedText>
    </View>
  );
}

function useRSI(symbol: string): RSISignal | null {
  const [signal, setSignal] = useState<RSISignal | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () =>
      api
        .rsi(symbol)
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

function timeOfDay(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
