/**
 * History — every round trip this wallet has made, as the design draws it.
 *
 * Grouped by day, filtered by strategy, and read two ways: Positions, which
 * is what happened (in at one price, out at another, and why), or Orders,
 * which is what was sent to the exchange — two lines per round trip, each
 * with the fee it paid. The same trades either way; only the reading
 * changes. Either one opens the card that reports it.
 *
 * Paged: seven round trips at a time, with the way to the next seven under
 * them. No totals above it: the risk screen has the week and the all-time
 * figures, and a total of one page is not a total.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { useAccount } from '@/account/useAccount';
import { api, ApiError, type Trade } from '@/api/client';
import { trim } from '@/components/format';
import { PAGE_SIZE, STRATEGY_NAMES } from '@/config';
import { Bone, FadeIn } from '@/ui/anim';
import { Pager } from '@/ui/pager';
import { back } from '@/ui/stub';
import { Card, Chip, Screen } from '@/ui/surface';
import { Text, money } from '@/ui/text';
import { useTop } from '@/ui/inset';
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
  const top = useTop();
  // Not before the account layer has read the device: a request that leaves
  // without the wallet on it is answered "sign in".
  const knows = useAccount().state.status !== 'loading';
  const [tab, setTab] = useState<Tab>('positions');
  const [filter, setFilter] = useState('all');
  const { trades, problem, page, hasNext, next, prev, loading, orderOffset } = useHistory(knows, filter, tab);

  return (
    <Screen testID="history">
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: top, paddingBottom: theme.space.s6, gap: theme.space.s4 }}
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
            {trades.length === 0 ? (
              <Card testID="history-empty">
                <Text variant="bodyStrong">No trades yet</Text>
                <Text variant="small">
                  Your first tap lands here: the price you got, what it cost, and what it made.
                </Text>
              </Card>
            ) : tab === 'positions' ? (
              byDay(trades).map(([day, list]) => (
                <View key={day} style={{ gap: theme.space.s1 }}>
                  <Text variant="small" style={{ fontSize: theme.type.t2xs }}>{day}</Text>
                  {list.map((t, i) => (
                    <PositionRow key={t.id ?? `${t.opened_at}-${i}`} t={t} />
                  ))}
                </View>
              ))
            ) : (
              byDayOrders(ordersOf(trades).slice(orderOffset, orderOffset + PAGE_SIZE)).map(([day, list]) => (
                <View key={day} style={{ gap: theme.space.s1 }}>
                  <Text variant="small" style={{ fontSize: theme.type.t2xs }}>{day}</Text>
                  {list.map((o) => (
                    <OrderRow key={o.key} title={o.title} note={o.note} onPress={o.onPress} />
                  ))}
                </View>
              ))
            )}

            {trades.length > 0 || page > 1 ? <Pager page={page} hasNext={hasNext} onPrev={prev} onNext={next} busy={loading} testID="history-pager" /> : null}
          </FadeIn>
        )}
      </ScrollView>
    </Screen>
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
        {/* The market and what was put on it lead the row: with the filter on
            All every strategy is in the list, so the asset is what tells one
            row from the next. The strategy moves under it. */}
        <Text variant="body" numberOfLines={1} style={{ fontSize: theme.type.tSm, color: theme.color.ink }}>
          {`${t.symbol} · ${t.side === 'long' ? 'Up' : 'Down'}${t.notional ? ` · ${money(Number(t.notional))} AUSD` : ''} @ ${trim(t.entry_price)}${t.exit_price ? ` → ${trim(t.exit_price)}` : ''}`}
        </Text>
        <Text variant="small" numberOfLines={1} style={{ fontSize: theme.type.t2xs }}>
          {`${STRATEGY_NAMES[t.strategy] ?? t.strategy}${t.leverage ? ` · ${trim(t.leverage)}×` : ''} · ${hm(t.opened_at)}${t.closed_at ? ` – ${hm(t.closed_at)}` : ''} · ${why(t)}`}
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

/** One order as the list shows it, with the fill it belongs to. */
type OrderLine = { key: string; title: string; note: string; at: string; onPress?: () => void };

/**
 * The same round trips as the exchange saw them: two orders each, the
 * close first because it is the news. A page is seven of these, whatever
 * that makes in round trips.
 */
function ordersOf(trades: Trade[]): OrderLine[] {
  const out: OrderLine[] = [];
  for (const t of trades) {
    const side = t.side === 'long' ? 'Up' : 'Down';
    const open = (which: 'open' | 'close') =>
      t.id ? () => router.push({ pathname: '/trade/[id]', params: { id: t.id!, strategy: t.strategy, order: which } }) : undefined;
    const id = t.id ?? t.opened_at;
    if (t.closed_at) {
      out.push({ key: `${id}-close`, title: `Close ${side} · @ ${trim(t.exit_price ?? '0')}`, note: `${hm(t.closed_at)} · fee ${Number(t.exit_fee ?? 0).toFixed(2)}`, at: t.closed_at, onPress: open('close') });
    }
    out.push({ key: `${id}-open`, title: `Open ${side} · @ ${trim(t.entry_price)}`, note: `${hm(t.opened_at)} · fee ${Number(t.entry_fee).toFixed(2)}`, at: t.opened_at, onPress: open('open') });
  }
  return out;
}

function byDayOrders(orders: OrderLine[]): [string, OrderLine[]][] {
  const groups = new Map<string, OrderLine[]>();
  for (const o of orders) {
    const day = dayName(new Date(o.at).getTime());
    const list = groups.get(day);
    if (list) list.push(o);
    else groups.set(day, [o]);
  }
  return [...groups.entries()];
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
 * every account that ever traded has that one. Pages already read are kept,
 * so going back is free; going forward past them asks for the next.
 */
function useHistory(ready: boolean, filter: string, tab: Tab) {
  // One state, keyed by the filter it belongs to: switching filters must
  // show nothing rather than the last one's rows, and resetting state from
  // inside the effect that reloads it is a render the screen does not need.
  // Everything read so far is kept in one list; the page is cut from it
  // seven rows at a time — round trips on one tab, orders on the other —
  // and the platform is asked for more only when the cut runs short.
  const [book, setBook] = useState<{ key: string; trades: Trade[]; cursor: string | null; at: number }>({ key: '', trades: [], cursor: null, at: 0 });
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<'locked' | 'offline' | null>(null);
  const current = book.key === filter;
  // Orders are two per closed round trip: a page of seven orders needs
  // fewer round trips than a page of seven positions.
  const rowsOf = (trades: Trade[]) => (tab === 'orders' ? trades.reduce((n, t) => n + (t.closed_at ? 2 : 1), 0) : trades.length);
  const PAGE = PAGE_SIZE;

  const read = useCallback(
    async (after?: string) => {
      // No filter is an empty one: the platform reads that as every strategy
      // this wallet has traded. Naming a strategy here used to be how the
      // request was signed rather than how it was filtered, so every chip
      // returned the same rows.
      const strategy = filter === 'all' ? '' : filter;
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
      setBook({ key: filter, trades: answer.trades, cursor: answer.next_cursor ?? null, at: 0 });
    }, 0);
    return () => {
      alive = false;
      clearTimeout(first);
    };
  }, [ready, filter, read]);

  // The round trips whose rows fall on this page, in row terms.
  const slice = (trades: Trade[], at: number): Trade[] => {
    const from = at * PAGE;
    const to = from + PAGE;
    const out: Trade[] = [];
    let row = 0;
    for (const t of trades) {
      const n = tab === 'orders' ? (t.closed_at ? 2 : 1) : 1;
      if (row + n > from && row < to) out.push(t);
      row += n;
      if (row >= to) break;
    }
    return out;
  };
  const total = rowsOf(book.trades);
  const pageTrades = current ? slice(book.trades, book.at) : [];
  const covers = (at: number) => total >= (at + 1) * PAGE;

  const next = useCallback(() => {
    if (!current || loading) return;
    const target = book.at + 1;
    // Enough rows read already for the next page, or none left to ask for.
    if (total > target * PAGE && (covers(target) || !book.cursor)) {
      setBook((have) => ({ ...have, at: target }));
      return;
    }
    if (!book.cursor) return;
    setLoading(true);
    void read(book.cursor)
      .then((answer) => {
        if (!answer) return;
        setBook((have) => (have.key === filter ? { key: filter, trades: [...have.trades, ...answer.trades], cursor: answer.next_cursor ?? null, at: target } : have));
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, book.at, book.cursor, loading, read, filter, total]);

  const prev = useCallback(() => {
    if (!current || book.at === 0) return;
    setBook((have) => ({ ...have, at: Math.max(0, have.at - 1) }));
  }, [current, book.at]);

  // Where this page's first order sits inside the round trips handed back:
  // a page boundary can fall between a close and its open.
  let before = 0;
  if (current) {
    for (const t of book.trades) {
      if (pageTrades.includes(t)) break;
      before += tab === 'orders' ? (t.closed_at ? 2 : 1) : 1;
    }
  }
  return {
    trades: current ? pageTrades : null,
    orderOffset: Math.max(0, book.at * PAGE - before),
    problem,
    page: book.at + 1,
    hasNext: current && (total > (book.at + 1) * PAGE || book.cursor !== null),
    next,
    prev,
    loading,
  };
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
  return t.close_reason === 'horizon' ? 'by timer' : t.close_reason === 'stop' ? 'stop' : t.close_reason === 'take_profit' ? 'take profit' : 'closed';
}
