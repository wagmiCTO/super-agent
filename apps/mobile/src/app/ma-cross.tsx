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
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Polyline } from 'react-native-svg';

import { useAccount } from '@/account/useAccount';
import { api, type MACrossSignal } from '@/api/client';
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
  useCountdown,
} from '@/components/trading';
import { DEFAULT_SYMBOL, HORIZON_PRESETS, horizonSeconds, NOTIONAL_PRESETS, SIGNAL_POLL_MS, type Horizon } from '@/config';
import { useTheme } from '@/hooks/use-theme';
import { useTrading } from '@/trading/useTrading';

type Notional = (typeof NOTIONAL_PRESETS)[number];

const UP = '#16a34a';
const DOWN = '#dc2626';

export default function MACrossScreen() {
  const account = useAccount();
  const t = useTrading(DEFAULT_SYMBOL);
  const signal = useSignal(DEFAULT_SYMBOL);
  const [notional, setNotional] = useState<Notional>('20');
  const [horizon, setHorizon] = useState<Horizon>('15m');
  const window = signal?.window ?? null;
  const windowLeft = useCountdown(window?.expires_at ?? null);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <ScreenHeader title={`MA CROSS · ${DEFAULT_SYMBOL}`} state={t.state} offline={t.offline} />

          <AccountSection account={account} state={t.state} onChange={t.refresh} />

          <SignalCard signal={signal} windowLeft={windowLeft} />

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
          <LimitsFooter state={t.state} />

          <Link href="/" style={styles.link} accessibilityRole="link">
            <ThemedText type="smallBold" themeColor="textSecondary">
              ← Direction
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
function SignalCard({ signal, windowLeft }: { signal: MACrossSignal | null; windowLeft: string | null }) {
  const theme = useTheme();
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
      {signal ? <Chart signal={signal} color={trendColor} priceColor={theme.textSecondary} /> : null}
    </View>
  );
}

const CHART_W = 320;
const CHART_H = 120;

/** Last hour of closes, and the slow average where it exists. */
function Chart({ signal, color, priceColor }: { signal: MACrossSignal; color: string; priceColor: string }) {
  const points = signal.points.slice(-60);
  const values = points.flatMap((p) => [Number(p.close), ...(p.slow ? [Number(p.slow)] : [])]);
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || max * 0.001 || 1;
  const x = (i: number) => (i / Math.max(1, points.length - 1)) * CHART_W;
  const y = (v: number) => CHART_H - ((v - min) / span) * (CHART_H - 8) - 4;
  const price = points.map((p, i) => `${x(i)},${y(Number(p.close))}`).join(' ');
  const slow = points
    .map((p, i) => (p.slow ? `${x(i)},${y(Number(p.slow))}` : null))
    .filter((s): s is string => s !== null)
    .join(' ');
  return (
    <Svg width="100%" height={CHART_H} viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" testID="signal-chart">
      <Polyline points={price} fill="none" stroke={priceColor} strokeWidth={1} />
      {slow ? <Polyline points={slow} fill="none" stroke={color} strokeWidth={2.5} /> : null}
    </Svg>
  );
}

function timeOfDay(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
