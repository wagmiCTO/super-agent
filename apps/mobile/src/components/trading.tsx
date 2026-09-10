/**
 * The parts every strategy screen is built from. A strategy screen chooses
 * which of these to show and when; it does not restyle them.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { Market, Position, State, Trade } from '@/api/client';
import { ThemedText } from '@/components/themed-text';
import { DEFAULT_LEVERAGE } from '@/config';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Notice } from '@/trading/useTrading';
import { clock, multiply, trim } from './format';

/** Strategy name and balance line, at the top of every screen. */
export function ScreenHeader({ title, state, offline, locked = false }: { title: string; state: State | null; offline: boolean; locked?: boolean }) {
  return (
    <View style={styles.header}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {title}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {state ? `Balance ${trim(state.account.balance)}` : offline ? 'Server unreachable' : locked ? 'Sign in to trade' : 'Loading…'}
      </ThemedText>
    </View>
  );
}

/** The one number: unrealized PnL while open; the cost of entry while flat. */
export function PositionCard({
  position,
  market,
  notional,
  stop = '0',
  state = null,
}: {
  position: Position | null;
  market: Market | null;
  notional: string;
  /** The stop the next tap arms, as a fraction of collateral ("0" = none). */
  stop?: string;
  state?: State | null;
}) {
  const theme = useTheme();
  const closesIn = useCountdown(position?.closes_at ?? null);
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
        <ThemedText type="small" themeColor="textSecondary" testID="position-footer">
          unrealized · fees paid {trim(position.fees_paid)}
          {position.stop_pnl ? ` · stop at ${trim(position.stop_pnl)}` : ''}
          {closesIn !== null ? ` · closes in ${closesIn}` : ''}
        </ThemedText>
      </View>
    );
  }
  const bps = market?.fees.round_trip_taker_bps;
  const fee = market ? multiply(notional, market.fees.round_trip_taker) : null;
  const risk = tapRisk(notional, stop, state);
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
      {risk ? (
        <ThemedText type="small" themeColor="textSecondary" testID="tap-risk">
          {risk}
        </ThemedText>
      ) : null}
    </View>
  );
}

/** A row of mutually exclusive choices: amounts, horizons. */
export function PresetRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.presets}>
      {options.map((o) => (
        <Pressable
          key={o}
          accessibilityRole="button"
          accessibilityLabel={`${label} ${o}`}
          accessibilityState={{ selected: o === value }}
          onPress={() => onChange(o)}
          style={[styles.preset, { backgroundColor: o === value ? theme.backgroundSelected : theme.backgroundElement }]}>
          <ThemedText type="smallBold">{o}</ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

export function DirectionButton({
  label,
  color,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  color: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
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

export function CloseButton({ busy, disabled, onPress }: { busy: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Close position"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.closeButton, { opacity: pressed || disabled ? 0.6 : 1 }]}>
      {busy ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonLabel}>Close</ThemedText>}
    </Pressable>
  );
}

export function SmallButton({ label, onPress, busy }: { label: string; onPress: () => void; busy: boolean }) {
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

export function NoticeBox({ notice }: { notice: Notice | null }) {
  const theme = useTheme();
  if (!notice) return null;
  return (
    <View testID="notice" style={[styles.notice, { backgroundColor: notice.kind === 'error' ? '#fee2e2' : theme.backgroundElement }]}>
      <ThemedText type="small" style={notice.kind === 'error' ? { color: '#991b1b' } : undefined}>
        {notice.text}
      </ThemedText>
    </View>
  );
}

export function LimitsFooter({ state }: { state: State | null }) {
  if (!state) return null;
  return (
    <ThemedText type="small" themeColor="textSecondary" style={styles.footer}>
      Limits: up to {state.limits.max_notional} per position · {state.limits.max_leverage}x · daily loss {state.risk.daily_loss} of{' '}
      {state.limits.daily_loss}
      {state.killed ? ' · trading paused' : ''}
    </ThemedText>
  );
}

/**
 * This strategy's history, two ways: positions (round trips with their
 * result) and orders (every fill, entries and exits alike, with its fee).
 */
export function HistoryCard({ trades }: { trades: Trade[] }) {
  const theme = useTheme();
  const [tab, setTab] = useState<'Positions' | 'Orders'>('Positions');
  const orders = tradesToOrders(trades);
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement, alignItems: 'stretch', gap: Spacing.two }]} testID="history">
      <PresetRow label="History" options={['Positions', 'Orders'] as const} value={tab} onChange={setTab} />
      {tab === 'Positions' ? (
        trades.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.footer}>
            No positions in this strategy yet
          </ThemedText>
        ) : (
          trades.map((t, i) => <PositionRow key={`${t.opened_at}-${i}`} trade={t} />)
        )
      ) : orders.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.footer}>
          No orders in this strategy yet
        </ThemedText>
      ) : (
        orders.map((o, i) => <OrderRow key={`${o.at}-${i}`} order={o} />)
      )}
    </View>
  );
}

function PositionRow({ trade: t }: { trade: Trade }) {
  const theme = useTheme();
  const open = !t.closed_at;
  const pnl = Number(t.pnl ?? 0);
  const color = open ? theme.textSecondary : pnl > 0 ? '#16a34a' : pnl < 0 ? '#dc2626' : theme.text;
  return (
    <View style={styles.header} testID="history-position">
      <View style={{ flex: 1 }}>
        <ThemedText type="small">
          {t.side === 'long' ? 'Up' : 'Down'} · {trim(t.size)} @ {trim(t.entry_price)}
          {t.exit_price ? ` → ${trim(t.exit_price)}` : ''}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {clockTime(t.opened_at)}
          {t.closed_at ? ` – ${clockTime(t.closed_at)} · ${t.close_reason === 'horizon' ? 'by timer' : 'closed'}` : ' · open'}
        </ThemedText>
      </View>
      <ThemedText type="smallBold" style={{ color }}>
        {open ? 'open' : `${pnl > 0 ? '+' : ''}${trim(t.pnl ?? '0')}`}
      </ThemedText>
    </View>
  );
}

type OrderLine = { at: string; label: string; size: string; price: string; fee: string; side: 'long' | 'short' };

/** Each round trip is two fills: the entry and, once closed, the exit. */
function tradesToOrders(trades: Trade[]): OrderLine[] {
  const out: OrderLine[] = [];
  for (const t of trades) {
    if (t.closed_at && t.exit_price) {
      out.push({ at: t.closed_at, label: `Close ${t.side === 'long' ? 'Up' : 'Down'}${t.close_reason === 'horizon' ? ' · timer' : ''}`, size: t.size, price: t.exit_price, fee: t.exit_fee ?? '0', side: t.side });
    }
    out.push({ at: t.opened_at, label: `Open ${t.side === 'long' ? 'Up' : 'Down'}`, size: t.size, price: t.entry_price, fee: t.entry_fee, side: t.side });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

function OrderRow({ order: o }: { order: OrderLine }) {
  return (
    <View style={styles.header} testID="history-order">
      <View style={{ flex: 1 }}>
        <ThemedText type="small">
          {o.label} · {trim(o.size)} @ {trim(o.price)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {clockTime(o.at)} · fee {trim(o.fee)}
        </ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        filled
      </ThemedText>
    </View>
  );
}

function clockTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === today.toDateString() ? hm : `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')} ${hm}`;
}

/**
 * What the next tap puts at risk, in words: the collateral (notional over
 * leverage), cut to the stop when one is armed, against today's remaining
 * loss budget from the platform's limits.
 */
export function tapRisk(notional: string, stop: string, state: State | null): string | null {
  const n = Number(notional);
  const lev = Number(DEFAULT_LEVERAGE);
  if (!n || !lev) return null;
  const collateral = n / lev;
  const frac = Number(stop);
  const atRisk = frac > 0 ? collateral * frac : collateral;
  let text = frac > 0 ? `This tap risks up to ${fmt(atRisk)} (stop at −${Math.round(frac * 100)}% of ${fmt(collateral)} collateral)` : `This tap risks up to ${fmt(collateral)} — the whole collateral, no stop`;
  if (state) {
    const left = Math.max(0, Number(state.limits.daily_loss) - Number(state.risk.daily_loss));
    if (left > 0) text += ` · ${Math.min(999, Math.round((atRisk / left) * 100))}% of today's ${fmt(left)} loss budget`;
    else text += ' · today\'s loss budget is spent';
  }
  return text;
}

function fmt(v: number): string {
  return v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2).replace(/\.?0+$/, '');
}

/** A mm:ss (or h:mm:ss) countdown to an ISO time; null without one. */
export function useCountdown(until: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  if (!until) return null;
  return clock((new Date(until).getTime() - now) / 1000);
}

export const styles = StyleSheet.create({
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
  smallButton: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.two, borderRadius: 8, alignItems: 'center' },
  buttonLabel: { color: '#fff', fontSize: 20, fontWeight: '700' },
  notice: { borderRadius: 10, padding: Spacing.two },
  footer: { textAlign: 'center' },
  link: { alignSelf: 'center', paddingVertical: Spacing.one },
});
