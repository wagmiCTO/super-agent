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

import { useAccount } from '@/account/useAccount';
import { useExchange } from '@/exchange/useExchange';
import { api, ApiError, describeError, type Market, type Position, type State } from '@/api/client';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { DEFAULT_LEVERAGE, DEFAULT_SYMBOL, NOTIONAL_PRESETS, STATE_POLL_MS } from '@/config';
import { Colors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Notional = (typeof NOTIONAL_PRESETS)[number];

/** What stands between this wallet and its first order, in the user's words. */
const ACCOUNT_STATUS_HINT: Record<State['account']['status'], string> = {
  no_exchange_account: 'Exchange account not activated yet — fund the wallet with MON and AUSD, then activate trading',
  forwarding_disabled: 'Exchange account exists but API trading is not authorized yet',
  frozen: 'The exchange has frozen this account',
  active: '',
};

export default function DirectionScreen() {
  const theme = useTheme();
  const account = useAccount();
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

          <AccountRow account={account} onExchangeChange={refresh} />

          {state && state.account.status !== 'active' ? (
            <ThemedText type="small" themeColor="textSecondary" testID="account-status">
              {ACCOUNT_STATUS_HINT[state.account.status]}
            </ThemedText>
          ) : null}

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

/**
 * The account layer, in one row: a passkey creates or unlocks the wallet, and
 * the address is the proof. No seed phrase, no extension, nothing custodial.
 */
function AccountRow({
  account,
  onExchangeChange,
}: {
  account: ReturnType<typeof useAccount>;
  onExchangeChange: () => void;
}) {
  const theme = useTheme();
  const { state, busy, error } = account;
  const address = state.status === 'unlocked' || state.status === 'remembered' ? state.stored.address : null;
  const exchange = useExchange(state.status === 'unlocked' ? state.wallet : null);
  // The request header now names a different account: re-read its state at once.
  const exchangeStatus = exchange.state.status;
  useEffect(() => {
    onExchangeChange();
  }, [exchangeStatus, onExchangeChange]);
  return (
    <View style={[styles.accountRow, { backgroundColor: theme.backgroundElement }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <ThemedText type="small" themeColor="textSecondary">
          {state.status === 'unlocked' ? 'Signed in with passkey' : state.status === 'remembered' ? 'Locked · passkey to unlock' : 'No account'}
        </ThemedText>
        {address ? (
          <ThemedText type="code" testID="account-address" selectable>
            {address}
          </ThemedText>
        ) : (
          <ThemedText type="small">Create one with a passkey — no seed phrase</ThemedText>
        )}
        {error ? (
          <ThemedText type="small" style={{ color: '#991b1b' }} testID="account-error">
            {error}
          </ThemedText>
        ) : null}
        {state.status === 'unlocked' && exchange.state.status === 'connected' ? (
          <ThemedText type="small" themeColor="textSecondary" testID="exchange-status">
            Exchange connected · builder {exchange.state.key.builder_id} · fee up to {exchange.state.key.max_builder_fee_pct}
          </ThemedText>
        ) : null}
        {exchange.error ? (
          <ThemedText type="small" style={{ color: '#991b1b' }} testID="exchange-error">
            {exchange.error}
          </ThemedText>
        ) : null}
      </View>
      <View style={{ gap: Spacing.one }}>
        {state.status === 'none' || state.status === 'loading' ? (
          <SmallButton label="Create account" onPress={() => void account.create()} busy={busy} />
        ) : null}
        {state.status !== 'unlocked' ? (
          <SmallButton label="Sign in" onPress={() => void account.signIn()} busy={busy} />
        ) : (
          <>
            {exchange.state.status === 'not-connected' ? (
              <SmallButton label="Connect exchange" onPress={() => void exchange.connect()} busy={exchange.busy} />
            ) : null}
            <SmallButton label="Sign out" onPress={() => void account.signOut()} busy={busy} />
          </>
        )}
      </View>
    </View>
  );
}

function SmallButton({ label, onPress, busy }: { label: string; onPress: () => void; busy: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [styles.smallButton, { backgroundColor: theme.backgroundSelected, opacity: pressed || busy ? 0.6 : 1 }]}>
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
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
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 12, padding: Spacing.two },
  smallButton: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.two, borderRadius: 8, alignItems: 'center' },
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
