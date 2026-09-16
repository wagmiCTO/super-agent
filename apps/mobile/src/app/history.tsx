/**
 * History — every round trip this wallet has made, as the design draws it.
 *
 * Grouped by day, filtered by strategy, and read two ways: Positions, which
 * is what happened (in at one price, out at another, and why), or Orders,
 * which is what was sent to the exchange — two lines per round trip, each
 * with the fee it paid. The same trades either way; only the reading
 * changes. Either one opens the card that reports it.
 *
 * Paged: the list only grows, so it arrives a screen at a time and the next
 * page is asked for as the bottom comes into view. The two totals above it
 * come from the risk report rather than from the rows on screen — a total
 * of the first page is not a total.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { useAccount } from '@/account/useAccount';
import { api, ApiError, type Perf, type Trade } from '@/api/client';
import { trim } from '@/components/format';
import { STRATEGY_NAMES } from '@/config';
import { useRiskReport } from '@/trading/useRiskReport';
import { Bone, FadeIn } from '@/ui/anim';
import { back } from '@/ui/stub';
import { Card, Chip, Screen } from '@/ui/surface';
import { Text, money } from '@/ui/text';
import { useTheme } from '@/theme';

const FILTERS: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'direction', label: 'Direction' },
  { id: 'ma-cross', label: 'MA Cross' },
  { id: 'rsi', label: 'RSI' },
];

type Tab = 'positions' | 'orders';

export default function HistoryScreen() {
  const theme = useTheme();
  // Not before the account layer has read the device: a request that leaves
  // without the wallet on it is answered "sign in".
  const knows = useAccount().state.status !== 'loading';
  const [tab, setTab] = useState<Tab>('positions');
  const [filter, setFilter] = useState('all');
  const { trades, problem, more, loading } = useHistory(knows, filter);
  const report = useRiskReport(knows);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 400) more();
  };

  return (
    <Screen testID="history">
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={200}
        contentContainerStyle={{ paddingTop: 52, paddingBottom: theme.space.s6, gap: theme.space.s4 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.s3 }}>
          <Text variant="small" numberOfLines={1} testID="lobby-link" onPress={back}>‹ Lobby</Text>
          <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: theme.type.tMd, flexShrink: 1 }} testID="history-title">History</Text>
          <View style={{ flex: 1 }} />
          <View style={{ flexDirection: 'row', gap: theme.space.s1 }}>
            <Chip label="Positions" small on={tab === 'positions'} onPress={() => setTab('positions')} testID="tab-positions" />
            <Chip label="Orders" small on={tab === 'orders'} onPress={() => setTab('orders')} testID="tab-orders" />
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: theme.space.s1 }}>
          {FILTERS.map((f) => (
            <Chip key={f.id} label={f.label} small on={filter === f.id} onPress={() => setFilter(f.id)} testID={`filter-${f.id}`} />
          ))}
        </View>

        {trades === null ? (
          <Loading problem={problem} />
        ) : (
          <FadeIn style={{ gap: theme.space.s4 }}>
            <Card style={{ gap: theme.space.s2 }} testID="history-totals">
              <Totals label="This week" perf={report?.totals.week} withFees={false} />
              <Totals label="All time" perf={report?.totals.all} withFees />
            </Card>

            {trades.length === 0 ? (
              <Card testID="history-empty">
                <Text variant="bodyStrong">No trades yet</Text>
                <Text variant="small">
                  Your first tap lands here: the price you got, what it cost, and what it made.
                </Text>
              </Card>
            ) : (
              byDay(trades).map(([day, list]) => (
                <View key={day} style={{ gap: theme.space.s1 }}>
                  <Text variant="small" style={{ fontSize: theme.type.t2xs }}>{day}</Text>
                  {list.map((t, i) =>
                    tab === 'positions' ? (
                      <PositionRow key={t.id ?? `${t.opened_at}-${i}`} t={t} />
                    ) : (
                      <OrderRows key={t.id ?? `${t.opened_at}-${i}`} t={t} />
                    ),
                  )}
                </View>
              ))
            )}

            {loading && trades.length > 0 ? (
              <Text variant="small" style={{ fontSize: theme.type.t2xs, textAlign: 'center' }} testID="history-more">Loading…</Text>
            ) : null}
          </FadeIn>
        )}
      </ScrollView>
    </Screen>
  );
}

/** What the wallet did over a stretch, in one line. */
function Totals({ label, perf, withFees }: { label: string; perf?: Perf; withFees: boolean }) {
  const theme = useTheme();
  const value = perf
    ? `${perf.trades} ${perf.trades === 1 ? 'trade' : 'trades'} · ${money(Number(perf.pnl))} · ${withFees ? `fees ${Number(perf.fees).toFixed(2)}` : `${perf.wins} won`}`
    : '…';
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.space.s3 }}>
      <Text variant="small" numberOfLines={1} style={{ color: theme.color.body }}>{label}</Text>
      <Text variant="num" numberOfLines={1} style={{ flexShrink: 1, fontSize: theme.type.tXs }}>{value}</Text>
    </View>
  );
}

/** A row that opens the card for what it names. */
function Row({ onPress, testID, children }: { onPress?: () => void; testID: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: theme.space.s3,
        paddingVertical: theme.space.s2,
        borderTopWidth: theme.size.bw,
        borderTopColor: theme.color.hair,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {children}
    </Pressable>
  );
}

/** One round trip: where it went in, where it came out, and who closed it. */
function PositionRow({ t }: { t: Trade }) {
  const theme = useTheme();
  // A position still running has no card of its own: there is nothing to
  // report until it closes, so the row says what it is and leads nowhere.
  const open = t.closed_at === undefined;
  const pnl = Number(t.pnl ?? 0);
  return (
    <Row
      testID="trade-row"
      onPress={t.id && !open ? () => router.push({ pathname: '/trade/[id]', params: { id: t.id!, strategy: t.strategy } }) : undefined}
    >
      <View style={{ gap: 2, flexShrink: 1 }}>
        <Text variant="body" numberOfLines={1} style={{ fontSize: theme.type.tSm, color: theme.color.ink }}>
          {`${STRATEGY_NAMES[t.strategy] ?? t.strategy} · ${t.side === 'long' ? 'Up' : 'Down'} @ ${trim(t.entry_price)}${t.exit_price ? ` → ${trim(t.exit_price)}` : ''}`}
        </Text>
        <Text variant="small" numberOfLines={1} style={{ fontSize: theme.type.t2xs }}>
          {`${hm(t.opened_at)}${t.closed_at ? ` – ${hm(t.closed_at)}` : ''} · ${why(t)}`}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.s2 }}>
        {open ? (
          <Text variant="small" style={{ fontSize: theme.type.tSm }}>open</Text>
        ) : (
          <>
            <Text variant="num" signOf={pnl} style={{ fontSize: theme.type.tSm }}>{money(pnl)}</Text>
            <Text variant="small" style={{ fontSize: theme.type.t2xs }}>›</Text>
          </>
        )}
      </View>
    </Row>
  );
}

/** The same round trip as the exchange saw it: the close, then the open. */
function OrderRows({ t }: { t: Trade }) {
  const side = t.side === 'long' ? 'Up' : 'Down';
  const open = (which: 'open' | 'close') =>
    t.id ? () => router.push({ pathname: '/trade/[id]', params: { id: t.id!, strategy: t.strategy, order: which } }) : undefined;
  return (
    <>
      {t.closed_at ? (
        <OrderRow
          title={`Close ${side} · @ ${trim(t.exit_price ?? '0')}`}
          note={`${hm(t.closed_at)} · fee ${Number(t.exit_fee ?? 0).toFixed(2)}`}
          onPress={open('close')}
        />
      ) : null}
      <OrderRow title={`Open ${side} · @ ${trim(t.entry_price)}`} note={`${hm(t.opened_at)} · fee ${Number(t.entry_fee).toFixed(2)}`} onPress={open('open')} />
    </>
  );
}

function OrderRow({ title, note, onPress }: { title: string; note: string; onPress?: () => void }) {
  const theme = useTheme();
  return (
    <Row testID="order-row" onPress={onPress}>
      <View style={{ gap: 2, flexShrink: 1 }}>
        <Text variant="body" numberOfLines={1} style={{ fontSize: theme.type.tSm, color: theme.color.ink }}>{title}</Text>
        <Text variant="small" numberOfLines={1} style={{ fontSize: theme.type.t2xs }}>{note}</Text>
      </View>
      <Text variant="small" style={{ fontSize: theme.type.t2xs }}>filled ›</Text>
    </Row>
  );
}

/** Waiting, or the reason there is nothing to wait for. */
function Loading({ problem }: { problem: 'locked' | 'offline' | null }) {
  const theme = useTheme();
  if (problem)
    return (
      <Text variant="small" testID="history-problem">
        {problem === 'locked' ? 'Sign in with your passkey and open an account to see your history.' : 'Server unreachable'}
      </Text>
    );
  return (
    <View style={{ gap: theme.space.s3 }}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Bone width={170} height={12} />
          <Bone width={60} height={12} />
        </View>
      ))}
    </View>
  );
}

/**
 * The wallet's round trips, a page at a time.
 *
 * One call, not one per strategy: the platform answers for the wallet, and
 * the filter chips narrow it server-side. The request is routed by the
 * filtered strategy's own key, or by Direction's when the filter is off —
 * every account that ever traded has that one.
 */
function useHistory(ready: boolean, filter: string) {
  // One state, keyed by the filter it belongs to: switching filters must
  // show nothing rather than the last one's rows, and resetting state from
  // inside the effect that reloads it is a render the screen does not need.
  const [page, setPage] = useState<{ key: string; trades: Trade[]; cursor: string | null }>({ key: '', trades: [], cursor: null });
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<'locked' | 'offline' | null>(null);
  const current = page.key === filter;

  const read = useCallback(
    async (after?: string) => {
      const strategy = filter === 'all' ? 'direction' : filter;
      try {
        return await api.tradesPage(strategy, after);
      } catch (e) {
        // A strategy this wallet never enabled has no trades under it, which
        // is an answer, not a failure. Anything else is worth saying.
        if (e instanceof ApiError && e.code === 'no_key' && filter !== 'all') return { trades: [], next_cursor: undefined };
        setProblem(e instanceof ApiError && e.code === 'network' ? 'offline' : 'locked');
        return null;
      }
    },
    [filter],
  );

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const first = setTimeout(async () => {
      setProblem(null);
      const answer = await read();
      if (!alive || !answer) return;
      setPage({ key: filter, trades: answer.trades, cursor: answer.next_cursor ?? null });
    }, 0);
    return () => {
      alive = false;
      clearTimeout(first);
    };
  }, [ready, filter, read]);

  const more = useCallback(() => {
    if (!current || !page.cursor || loading) return;
    setLoading(true);
    void read(page.cursor)
      .then((answer) => {
        if (!answer) return;
        setPage((have) =>
          have.key === filter ? { key: filter, trades: [...have.trades, ...answer.trades], cursor: answer.next_cursor ?? null } : have,
        );
      })
      .finally(() => setLoading(false));
  }, [current, page.cursor, loading, read, filter]);

  return { trades: current ? page.trades : null, problem, more, loading };
}

/** The trades of each day, newest day first. */
function byDay(trades: Trade[]): [string, Trade[]][] {
  const groups = new Map<string, Trade[]>();
  for (const t of trades) {
    const day = dayName(new Date(t.closed_at ?? t.opened_at).getTime());
    const list = groups.get(day);
    if (list) list.push(t);
    else groups.set(day, [t]);
  }
  return [...groups.entries()];
}

function dayName(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400e3);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString();
}

function hm(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Who closed it, in the design's words. */
function why(t: Trade): string {
  if (!t.closed_at) return 'open now';
  return t.close_reason === 'horizon' ? 'by timer' : t.close_reason === 'stop' ? 'stop' : 'closed';
}
