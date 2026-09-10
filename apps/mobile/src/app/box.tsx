/**
 * Strategy #3 — Box.
 *
 * The last thirty closed bars draw a box on the chart. Waiting inside it
 * costs nothing; when a bar closes outside, the screen lights up and offers
 * an entry in the breakout's direction for a few minutes. Same tap, same
 * horizon, same exit as the other strategies — only the invitation differs.
 */
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAccount } from '@/account/useAccount';
import { api, type BoxSignal } from '@/api/client';
import { AccountSection } from '@/components/account';
import { trim } from '@/components/format';
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

export default function BoxScreen() {
  const account = useAccount();
  const t = useTrading(DEFAULT_SYMBOL, 'box');
  const signal = useBox(DEFAULT_SYMBOL);
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
          <ScreenHeader title={`BOX · ${DEFAULT_SYMBOL}`} state={t.state} offline={t.offline} />

          <AccountSection account={account} state={t.state} onChange={t.refresh} />

          <View
            testID="signal-card"
            style={[
              styles.card,
              { backgroundColor: theme.backgroundElement, alignItems: 'stretch', borderWidth: 2, borderColor: lit ? sideColor : 'transparent' },
            ]}>
            <View style={styles.header}>
              <ThemedText type="small" themeColor="textSecondary" testID="signal-box">
                {signal?.ready ? `box ${trim(signal.bottom)} – ${trim(signal.top)} · ${signal.length}×1m` : 'Warming up the signal…'}
              </ThemedText>
              {window ? (
                <ThemedText type="smallBold" style={{ color: sideColor }} testID="signal-window">
                  {window.side === 'long' ? 'Broke up' : 'Broke down'} · {windowLeft ?? ''}
                </ThemedText>
              ) : signal?.last_break ? (
                <ThemedText type="small" themeColor="textSecondary" testID="signal-last-break">
                  last break {signal.last_break.side === 'long' ? 'up' : 'down'} · {timeOfDay(signal.last_break.at)}
                </ThemedText>
              ) : null}
            </View>
            <TVChart
              symbol={DEFAULT_SYMBOL}
              theme={dark ? 'dark' : 'light'}
              background={theme.backgroundElement}
              chartType={mode === 'Line' ? 'line' : 'candles'}
              trend={window ? (window.side === 'long' ? 'up' : 'down') : 'flat'}
              ma={0}
              box={signal?.ready ? { top: signal.top, bottom: signal.bottom } : null}
              trades={t.trades}
              position={t.position}
              height={280}
            />
            <PresetRow label="Chart" options={CHART_MODES} value={mode} onChange={setMode} />
          </View>

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
              {signal?.ready ? 'Inside the box — waiting is free. The screen lights up on a breakout' : 'Warming up the signal…'}
            </ThemedText>
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

function useBox(symbol: string): BoxSignal | null {
  const [signal, setSignal] = useState<BoxSignal | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () =>
      api
        .box(symbol)
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
