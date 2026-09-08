/**
 * Strategy #1 — Direction.
 *
 * Asset → up or down → amount → one number. The whole screen exists to make
 * the round trip legible: what it costs to enter, and what the position is
 * worth right now. Every order goes through the platform, which puts it
 * through the policy engine before the venue; a refusal comes back with the
 * limit that was hit and is shown in words.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, ApiError, describeError, type Market, type Position, type State } from '@/api/client';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { DEFAULT_LEVERAGE, DEFAULT_SYMBOL, NOTIONAL_PRESETS, STATE_POLL_MS } from '@/config';
import { Colors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Notional = (typeof NOTIONAL_PRESETS)[number];

export default function DirectionScreen() {
  const theme = useTheme();
  const [state, setState] = useState<State | null>(null);
  const [market, setMarket] = useState<Market | null>(null);
  const [notional, setNotional] = useState<Notional>('20');
  const [busy, setBusy] = useState<'up' | 'down' | 'close' | null>(null);
  const [notice, setNotice] = useState<{ text: string; kind: 'error' | 'info' } | null>(null);
  const [offline, setOffline] = useState(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const s = await api.state();
      if (!mounted.current) return;
      setState(s);
      setOffline(false);
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof ApiError && e.code === 'network') setOffline(true);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    api
      .markets()
      .then((ms) => mounted.current && setMarket(ms.find((m) => m.symbol === DEFAULT_SYMBOL) ?? null))
      .catch(() => undefined);
    const id = setInterval(refresh, STATE_POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [refresh]);

  const position = state?.positions.find((p) => p.symbol === DEFAULT_SYMBOL) ?? null;

  const open = async (side: 'long' | 'short') => {
    setBusy(side === 'long' ? 'up' : 'down');
    setNotice(null);
    try {
      const order = await api.open({ symbol: DEFAULT_SYMBOL, side, notional, leverage: DEFAULT_LEVERAGE });
      if (order.status === 'failed') {
        setNotice({ text: `The exchange refused: ${order.rejection?.code ?? 'unknown'}`, kind: 'error' });
      } else {
        setNotice({ text: `Filled ${order.filled_size} @ ${order.avg_price}, fee ${order.fee}`, kind: 'info' });
      }
      await refresh();
    } catch (e) {
      setNotice({ text: describeError(e), kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const close = async () => {
    setBusy('close');
    setNotice(null);
    try {
      const order = await api.close({ symbol: DEFAULT_SYMBOL });
      setNotice({ text: `Closed ${order.filled_size} @ ${order.avg_price}, fee ${order.fee}`, kind: 'info' });
      await refresh();
    } catch (e) {
      setNotice({ text: describeError(e), kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              DIRECTION · {DEFAULT_SYMBOL}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {state ? `Balance ${trim(state.account.balance)}` : offline ? 'Server unreachable' : 'Loading…'}
            </ThemedText>
          </View>

          <PositionCard position={position} market={market} notional={notional} />

          {position ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close position"
              onPress={close}
              disabled={busy !== null}
              style={({ pressed }) => [styles.closeButton, { opacity: pressed || busy ? 0.6 : 1 }]}>
              {busy === 'close' ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <ThemedText style={styles.buttonLabel}>Close</ThemedText>
              )}
            </Pressable>
          ) : (
            <>
              <View style={styles.presets}>
                {NOTIONAL_PRESETS.map((n) => (
                  <Pressable
                    key={n}
                    accessibilityRole="button"
                    accessibilityLabel={`Amount ${n}`}
                    accessibilityState={{ selected: n === notional }}
                    onPress={() => setNotional(n)}
                    style={[
                      styles.preset,
                      { backgroundColor: n === notional ? theme.backgroundSelected : theme.backgroundElement },
                    ]}>
                    <ThemedText type="smallBold">{n}</ThemedText>
                  </Pressable>
                ))}
              </View>
              <View style={styles.directions}>
                <DirectionButton label="Up" color="#16a34a" busy={busy === 'up'} disabled={busy !== null} onPress={() => open('long')} />
                <DirectionButton label="Down" color="#dc2626" busy={busy === 'down'} disabled={busy !== null} onPress={() => open('short')} />
              </View>
            </>
          )}

          {notice ? (
            <View
              testID="notice"
              style={[styles.notice, { backgroundColor: notice.kind === 'error' ? '#fee2e2' : theme.backgroundElement }]}>
              <ThemedText type="small" style={notice.kind === 'error' ? { color: '#991b1b' } : undefined}>
                {notice.text}
              </ThemedText>
            </View>
          ) : null}

          {state ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.footer}>
              Limits: up to {state.limits.max_notional} per position · {state.limits.max_leverage}x ·{' '}
              daily loss {state.risk.daily_loss} of {state.limits.daily_loss}
              {state.killed ? ' · trading paused' : ''}
            </ThemedText>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

/** The one number: unrealized PnL while open; the cost of entry while flat. */
function PositionCard({ position, market, notional }: { position: Position | null; market: Market | null; notional: string }) {
  const theme = useTheme();
  if (position) {
    const pnl = Number(position.unrealized_pnl);
    const color = pnl > 0 ? '#16a34a' : pnl < 0 ? '#dc2626' : theme.text;
    return (
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="small" themeColor="textSecondary">
          {position.side === 'long' ? 'Up' : 'Down'} · {trim(position.size)} {position.symbol} @ {trim(position.entry_price)} · {position.leverage}x
        </ThemedText>
        <ThemedText type="title" style={{ color }} testID="big-number">
          {pnl > 0 ? '+' : ''}
          {trim(position.unrealized_pnl)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          unrealized · fees paid {trim(position.fees_paid)}
        </ThemedText>
      </View>
    );
  }
  const bps = market?.fees.round_trip_taker_bps;
  const fee = market ? multiply(notional, market.fees.round_trip_taker) : null;
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="small" themeColor="textSecondary">
        No position
      </ThemedText>
      <ThemedText type="title" testID="big-number">
        {notional}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {fee !== null ? `round trip costs ${fee} (${bps} bps) · ${DEFAULT_LEVERAGE}x` : `${DEFAULT_LEVERAGE}x`}
      </ThemedText>
    </View>
  );
}

function DirectionButton({ label, color, busy, disabled, onPress }: { label: string; color: string; busy: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.direction, { backgroundColor: color, opacity: pressed || disabled ? 0.6 : 1 }]}>
      {busy ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonLabel}>{label}</ThemedText>}
    </Pressable>
  );
}

/** Trims trailing zeros for display only. Never feeds a request. */
function trim(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/\.?0+$/, '');
}

/** Display-only product of two decimal strings, to 4 places. Never feeds a request. */
function multiply(a: string, b: string): string {
  return (Number(a) * Number(b)).toFixed(4).replace(/\.?0+$/, '');
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, maxWidth: 520, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  card: { borderRadius: 16, padding: Spacing.four, gap: Spacing.one, alignItems: 'center' },
  presets: { flexDirection: 'row', gap: Spacing.two },
  preset: { flex: 1, paddingVertical: Spacing.two, borderRadius: 10, alignItems: 'center' },
  directions: { flexDirection: 'row', gap: Spacing.two },
  direction: { flex: 1, paddingVertical: Spacing.four, borderRadius: 14, alignItems: 'center' },
  closeButton: { paddingVertical: Spacing.four, borderRadius: 14, alignItems: 'center', backgroundColor: '#374151' },
  buttonLabel: { color: '#fff', fontSize: 20, fontWeight: '700' },
  notice: { borderRadius: 10, padding: Spacing.two },
  footer: { textAlign: 'center' },
});
