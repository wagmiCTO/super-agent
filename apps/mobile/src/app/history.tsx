/**
 * History — every round trip this wallet has made, as the design draws it.
 *
 * Grouped by day, filtered by strategy, and read two ways: Positions, which
 * is what happened (in at one price, out at another, and why), or Orders,
 * which is what was sent to the exchange — two lines per round trip, each
 * with the fee it paid. The same trades either way; only the reading changes.
 *
 * Above them, the two numbers people actually check: this week, and since
 * the beginning.
 *
 * The design gives each row a card of its own — the movement, the stop, the
 * worst and best moment it went through. Those last two are not in
 * `/v1/trades`, so the row does not pretend to lead anywhere yet.
 */
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { api, ApiError, type Trade } from '@/api/client';
import { trim } from '@/components/format';
import { DEFAULT_SYMBOL, STRATEGY_NAMES } from '@/config';
import { Bone, FadeIn } from '@/ui/anim';
import { back } from '@/ui/stub';
import { Card, Chip, Screen } from '@/ui/surface';
import { Text, money } from '@/ui/text';
import { useTheme } from '@/theme';

const STRATEGIES = ['direction', 'ma-cross', 'rsi'] as const;
const FILTERS: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'direction', label: 'Direction' },
  { id: 'ma-cross', label: 'MA Cross' },
  { id: 'rsi', label: 'RSI' },
];

type Tab = 'positions' | 'orders';

export default function HistoryScreen() {
  const theme = useTheme();
  const { trades, problem } = useHistory();
  const [tab, setTab] = useState<Tab>('positions');
  const [filter, setFilter] = useState('all');
  // Read once, when the screen opens: a week that moves between two renders
  // is a week that drops a trade off its own edge mid-scroll.
  const [openedAt] = useState(() => Date.now());

  const rows = (trades ?? []).filter((t) => filter === 'all' || t.strategy === filter);
  const week = (trades ?? []).filter((t) => t.closed_at && new Date(t.closed_at).getTime() > openedAt - 7 * 86400e3);

  return (
    <Screen testID="history">
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
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
              <Totals label="This week" trades={week} withFees={false} />
              <Totals label="All time" trades={trades} withFees />
            </Card>

            {rows.length === 0 ? (
              <Card testID="history-empty">
                <Text variant="bodyStrong">No trades yet</Text>
                <Text variant="small">
                  Your first tap lands here: the price you got, what it cost, and what it made.
                </Text>
              </Card>
            ) : (
              byDay(rows).map(([day, list]) => (
                <View key={day} style={{ gap: theme.space.s1 }}>
                  <Text variant="small" style={{ fontSize: theme.type.t2xs }}>{day}</Text>
                  {list.map((t, i) =>
                    tab === 'positions' ? (
                      <PositionRow key={`${t.opened_at}-${i}`} t={t} />
                    ) : (
                      <OrderRows key={`${t.opened_at}-${i}`} t={t} />
                    ),
                  )}
                </View>
              ))
            )}
          </FadeIn>
        )}
      </ScrollView>
    </Screen>
  );
}

/** What the wallet did over a stretch, in one line. */
function Totals({ label, trades, withFees }: { label: string; trades: Trade[]; withFees: boolean }) {
  const theme = useTheme();
  const closed = trades.filter((t) => t.closed_at);
  const pnl = closed.reduce((sum, t) => sum + Number(t.pnl ?? 0), 0);
  const fees = trades.reduce((sum, t) => sum + Number(t.entry_fee ?? 0) + Number(t.exit_fee ?? 0), 0);
  const won = closed.filter((t) => Number(t.pnl ?? 0) > 0).length;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.space.s3 }}>
      <Text variant="small" numberOfLines={1} style={{ color: theme.color.body }}>{label}</Text>
      <Text variant="num" numberOfLines={1} style={{ flexShrink: 1, fontSize: theme.type.tXs }}>
        {`${closed.length} ${closed.length === 1 ? 'trade' : 'trades'} · ${money(pnl)} · ${withFees ? `fees ${fees.toFixed(2)}` : `${won} won`}`}
      </Text>
    </View>
  );
}

/** One round trip: where it went in, where it came out, and who closed it. */
function PositionRow({ t }: { t: Trade }) {
  const theme = useTheme();
  const open = t.closed_at === undefined;
  const pnl = Number(t.pnl ?? 0);
  return (
    <View
      testID="history-position"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: theme.space.s3,
        paddingVertical: theme.space.s2,
        borderTopWidth: theme.size.bw,
        borderTopColor: theme.color.hair,
      }}
    >
      <View style={{ gap: 2, flexShrink: 1 }}>
        <Text variant="body" numberOfLines={1} style={{ fontSize: theme.type.tSm, color: theme.color.ink }}>
          {`${STRATEGY_NAMES[t.strategy] ?? t.strategy} · ${t.side === 'long' ? 'Up' : 'Down'} @ ${trim(t.entry_price)}${t.exit_price ? ` → ${trim(t.exit_price)}` : ''}`}
        </Text>
        <Text variant="small" numberOfLines={1} style={{ fontSize: theme.type.t2xs }}>
          {`${hm(t.opened_at)}${t.closed_at ? ` – ${hm(t.closed_at)}` : ''} · ${why(t)}`}
        </Text>
      </View>
      {open ? <Text variant="small" style={{ fontSize: theme.type.tSm }}>open</Text> : <Text variant="num" signOf={pnl} style={{ fontSize: theme.type.tSm }}>{money(pnl)}</Text>}
    </View>
  );
}

/** The same round trip as the exchange saw it: the close, then the open. */
function OrderRows({ t }: { t: Trade }) {
  const side = t.side === 'long' ? 'Up' : 'Down';
  return (
    <>
      {t.closed_at ? (
        <OrderRow title={`Close ${side} · @ ${trim(t.exit_price ?? '0')}`} note={`${hm(t.closed_at)} · fee ${Number(t.exit_fee ?? 0).toFixed(2)}`} />
      ) : null}
      <OrderRow title={`Open ${side} · @ ${trim(t.entry_price)}`} note={`${hm(t.opened_at)} · fee ${Number(t.entry_fee).toFixed(2)}`} />
    </>
  );
}

function OrderRow({ title, note }: { title: string; note: string }) {
  const theme = useTheme();
  return (
    <View
      testID="history-order"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: theme.space.s3,
        paddingVertical: theme.space.s2,
        borderTopWidth: theme.size.bw,
        borderTopColor: theme.color.hair,
      }}
    >
      <View style={{ gap: 2, flexShrink: 1 }}>
        <Text variant="body" numberOfLines={1} style={{ fontSize: theme.type.tSm, color: theme.color.ink }}>{title}</Text>
        <Text variant="small" numberOfLines={1} style={{ fontSize: theme.type.t2xs }}>{note}</Text>
      </View>
      <Text variant="small" style={{ fontSize: theme.type.t2xs }}>filled</Text>
    </View>
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
 * Every strategy's round trips, newest first.
 *
 * One call per strategy, as the risk screen does: each is answered by that
 * strategy's own key, and a wallet that never enabled one gets nothing for
 * it rather than an error for all three.
 */
function useHistory(): { trades: Trade[] | null; problem: 'locked' | 'offline' | null } {
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [problem, setProblem] = useState<'locked' | 'offline' | null>(null);
  useEffect(() => {
    let alive = true;
    const read = async () => {
      const lists = await Promise.all(
        STRATEGIES.map((s) =>
          api
            .trades(DEFAULT_SYMBOL, s)
            .then((list) => ({ list, err: null as ApiError | null }))
            .catch((e) => ({ list: [] as Trade[], err: e instanceof ApiError ? e : null })),
        ),
      );
      if (!alive) return;
      const errs = lists.map((l) => l.err).filter((e): e is ApiError => e !== null);
      // Every strategy refused for the same reason: it is the wallet, not the
      // strategy. One refusing while another answers is a wallet that simply
      // never enabled it.
      if (errs.length === STRATEGIES.length) {
        setProblem(errs[0].code === 'network' ? 'offline' : 'locked');
        return;
      }
      setProblem(null);
      setTrades(lists.flatMap((l) => l.list).sort((a, b) => at(b) - at(a)));
    };
    const first = setTimeout(read, 0);
    return () => {
      alive = false;
      clearTimeout(first);
    };
  }, []);
  return { trades, problem };
}

/** When a trade last changed hands — closed if it has, opened if not. */
function at(t: Trade): number {
  return new Date(t.closed_at ?? t.opened_at).getTime();
}

/** The trades of each day, newest day first. */
function byDay(trades: Trade[]): [string, Trade[]][] {
  const groups = new Map<string, Trade[]>();
  for (const t of trades) {
    const day = dayName(at(t));
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
