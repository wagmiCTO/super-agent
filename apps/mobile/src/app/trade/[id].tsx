/**
 * One round trip, reported — and the same screen for one of its two orders.
 *
 * What it was and who closed it, what it made and what that is of the money
 * put in, then the report: one fact per line, the set every exchange lists
 * for a closed position. No chart, and no worst-and-best moments — sampled
 * numbers next to exact ones read as exact.
 *
 * Rows the platform did not record for this trade say so with a dash: old
 * round trips have no leverage and no stop, and a card that invents them
 * would be a card that lies about money.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { useAccount } from '@/account/useAccount';
import { api, ApiError, type Trade } from '@/api/client';
import { trim } from '@/components/format';
import { STRATEGY_NAMES } from '@/config';
import { Bone, FadeIn } from '@/ui/anim';
import { back } from '@/ui/stub';
import { Card, Row, Screen } from '@/ui/surface';
import { Text, money } from '@/ui/text';
import { useTheme } from '@/theme';

export default function TradeScreen() {
  const theme = useTheme();
  const { id, strategy, order } = useLocalSearchParams<{ id: string; strategy?: string; order?: 'open' | 'close' }>();
  const knows = useAccount().state.status !== 'loading';
  const { trade, problem } = useTrade(knows, String(id), strategy ?? 'direction');
  const asOrder = order === 'open' || order === 'close';

  return (
    <Screen testID="trade">
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 52, paddingBottom: theme.space.s6, gap: theme.space.s4 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.s3 }}>
          <Text variant="small" numberOfLines={1} testID="history-link" onPress={back}>‹ History</Text>
          <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: theme.type.tMd, flexShrink: 1 }} testID="trade-title">
            {asOrder ? 'Order' : 'Trade'}
          </Text>
          <View style={{ flex: 1 }} />
          {trade ? (
            <Text variant="small" numberOfLines={1} style={{ fontSize: theme.type.t2xs }}>
              {asOrder ? `${shortID(order === 'close' ? trade.close_order_id : trade.open_order_id)} · filled` : STRATEGY_NAMES[trade.strategy] ?? trade.strategy}
            </Text>
          ) : null}
        </View>

        {problem ? (
          <Text variant="small" testID="trade-problem">
            {problem === 'missing'
              ? 'That trade is not on this wallet.'
              : problem === 'offline'
                ? 'Server unreachable'
                : 'Sign in with your passkey to see this trade.'}
          </Text>
        ) : !trade ? (
          <View style={{ gap: theme.space.s3 }}>
            <Bone width={180} height={14} />
            <Bone width={140} height={40} radius={8} />
            <Bone width="100%" height={120} radius={theme.radius.rLg} />
          </View>
        ) : (
          <FadeIn style={{ gap: theme.space.s4 }}>
            {asOrder ? <OrderHead trade={trade} side={order === 'close' ? 'close' : 'open'} /> : <TradeHead trade={trade} />}

            {asOrder ? (
              <Card style={{ gap: theme.space.s1 }} testID="order-card">
                {/* One fact per line, as the exchange's own order ticket has
                    it: what was sent, what it filled at, and what it cost. */}
                <Row label="Order" value={order === 'close' ? 'Close' : 'Open'} />
                <Row label="Side" value={order === 'close' ? (trade.side === 'long' ? 'Sell' : 'Buy') : trade.side === 'long' ? 'Buy' : 'Sell'} />
                <Row label="Type" value="Market" />
                <Row label="Size" value={`${trim(trade.size)} ${trade.symbol}`} />
                <Row label="Notional" value={`${notionalOf(trade).toFixed(2)} AUSD`} />
                <Row label="Leverage" value={trade.leverage ? `${trim(trade.leverage)}x` : '—'} />
                <Row label="Fill price" value={trim((order === 'close' ? trade.exit_price : trade.entry_price) ?? '0')} />
                <Row label="Fee" value={`${Number((order === 'close' ? trade.exit_fee : trade.entry_fee) ?? 0).toFixed(4)} AUSD`} />
                <Row label="Filled" value={when((order === 'close' ? trade.closed_at : trade.opened_at) ?? '')} />
                <Row label="Status" value="Filled" />
                <Row label="Order id" value={shortID(order === 'close' ? trade.close_order_id : trade.open_order_id)} />
                {/* The way to the round trip, once there is one to show.
                    While the position is open there is no trade to report,
                    so the order is the whole of it. */}
                {trade.closed_at ? (
                  <Pressable
                    testID="to-trade"
                    accessibilityRole="link"
                    onPress={() => router.replace({ pathname: '/trade/[id]', params: { id: String(id), strategy: trade.strategy } })}
                    style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: theme.space.s2, marginTop: theme.space.s1, borderTopWidth: theme.size.bw, borderTopColor: theme.color.hair }}
                  >
                    <Text variant="small" style={{ color: theme.color.body }}>The trade</Text>
                    <Text variant="num" signOf={Number(trade.pnl ?? 0)} style={{ fontSize: theme.type.tSm }}>{`closed ${when(trade.closed_at)} · ${money(Number(trade.pnl ?? 0))} ›`}</Text>
                  </Pressable>
                ) : null}
              </Card>
            ) : (
              <Card style={{ gap: theme.space.s1 }} testID="trade-report">
                {/* One fact per line, the way every exchange lists a closed
                    position — nothing to decode, nothing to add up. */}
                <Row label="Strategy" value={STRATEGY_NAMES[trade.strategy] ?? trade.strategy} />
                <Row label="Side" value={up(trade)} />
                <Row label="Entry price" value={trim(trade.entry_price)} />
                <Row label="Exit price" value={trade.exit_price ? trim(trade.exit_price) : '—'} />
                <Row label="Price change" value={trade.exit_price ? `${movedBy(trade) > 0 ? '+' : ''}${movedBy(trade).toFixed(2)}%` : '—'} tone={movedBy(trade)} />
                <Row label="Size" value={`${trim(trade.size)} ${trade.symbol}`} />
                <Row label="Notional" value={`${notionalOf(trade).toFixed(2)} AUSD`} />
                <Row label="Leverage" value={trade.leverage ? `${trim(trade.leverage)}x` : '—'} />
                <Row label="Margin" value={trade.collateral ? `${Number(trade.collateral).toFixed(2)} AUSD` : '—'} />
                <Row label="Stop" value={trade.stop_pnl ? `${money(Number(trade.stop_pnl))} AUSD` : 'off'} />
                <Row label="Take profit" value={trade.tp_pnl ? `${money(Number(trade.tp_pnl))} AUSD` : 'off'} />
                <Row label="Opened" value={when(trade.opened_at)} />
                <Row label="Closed" value={trade.closed_at ? when(trade.closed_at) : '—'} />
                <Row label="Duration" value={trade.closed_at ? duration(trade) : '—'} />
                <Row label="Closed by" value={!trade.closed_at ? '—' : trade.close_reason === 'horizon' ? 'timer' : trade.close_reason === 'stop' ? 'stop' : trade.close_reason === 'take_profit' ? 'take profit' : 'you'} />
                <Row label="Fees" value={`${(Number(trade.entry_fee) + Number(trade.exit_fee ?? 0)).toFixed(2)} AUSD`} />
                <Row label="Realized PnL" value={trade.closed_at ? `${money(Number(trade.pnl ?? 0))} AUSD` : '—'} tone={trade.closed_at ? Number(trade.pnl ?? 0) : undefined} />
                <Row
                  label="Return on margin"
                  value={trade.closed_at && trade.collateral && Number(trade.collateral) > 0 ? `${returnOn(trade) > 0 ? '+' : ''}${returnOn(trade).toFixed(1)}%` : '—'}
                  tone={trade.closed_at ? returnOn(trade) : undefined}
                />
              </Card>
            )}

            <Text variant="small" style={{ fontSize: theme.type.t2xs }} testID="trade-orders">
              {`Order ids ${shortID(trade.open_order_id)}${trade.close_order_id ? `, ${shortID(trade.close_order_id)}` : ''} · filled at the exchange`}
            </Text>
          </FadeIn>
        )}
      </ScrollView>
    </Screen>
  );
}

/** What it was, what it made, and what that is of the money put in. */
function TradeHead({ trade }: { trade: Trade }) {
  const theme = useTheme();
  const pnl = Number(trade.pnl ?? 0);
  const onCollateral = trade.closed_at && trade.collateral && Number(trade.collateral) > 0 ? (pnl / Number(trade.collateral)) * 100 : null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: theme.space.s3 }}>
      <View style={{ flexShrink: 1 }}>
        <Text variant="caps" testID="trade-what">
          {`${STRATEGY_NAMES[trade.strategy] ?? trade.strategy} · ${up(trade)} · ${reason(trade)}`}
        </Text>
        <Text variant="hero" signOf={pnl} style={{ marginTop: theme.space.s2 }} testID="trade-pnl">{money(pnl)}</Text>
        <Text variant="small" style={{ fontSize: theme.type.tSm }}>
          {trade.closed_at ? `AUSD · ${when(trade.opened_at)} – ${when(trade.closed_at)}` : `AUSD · open since ${when(trade.opened_at)}`}
        </Text>
      </View>
      {onCollateral !== null ? (
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="num" signOf={pnl} style={{ fontSize: theme.type.tXl }}>{`${onCollateral > 0 ? '+' : ''}${onCollateral.toFixed(1)}%`}</Text>
          <Text variant="small" numberOfLines={1} style={{ fontSize: theme.type.t2xs }}>{`of the ${Number(trade.collateral).toFixed(2)} you put in`}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** One side of it, as the exchange filled it: the price, and what it was for. */
function OrderHead({ trade, side }: { trade: Trade; side: 'open' | 'close' }) {
  const theme = useTheme();
  const price = (side === 'close' ? trade.exit_price : trade.entry_price) ?? '0';
  const at = (side === 'close' ? trade.closed_at : trade.opened_at) ?? '';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: theme.space.s3 }}>
      <View style={{ flexShrink: 1 }}>
        <Text variant="caps" testID="order-what">{`${side === 'close' ? 'Close' : 'Open'} · ${up(trade)} · ${STRATEGY_NAMES[trade.strategy] ?? trade.strategy}`}</Text>
        <Text variant="numLarge" testID="order-price" style={{ marginTop: theme.space.s2 }}>{trim(price)}</Text>
        <Text variant="small" style={{ fontSize: theme.type.tSm }}>{`${trade.symbol} · filled at market · ${when(at)}`}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text variant="num" style={{ fontSize: theme.type.tXl }}>{`${trim(trade.size)}`}</Text>
        <Text variant="small" numberOfLines={1} style={{ fontSize: theme.type.t2xs }}>{`${trade.symbol} · ${notionalOf(trade).toFixed(2)} AUSD`}</Text>
      </View>
    </View>
  );
}

function up(t: Trade): string {
  return t.side === 'long' ? 'Up' : 'Down';
}

function reason(t: Trade): string {
  if (!t.closed_at) return 'open now';
  return t.close_reason === 'horizon' ? 'by timer' : t.close_reason === 'stop' ? 'stopped' : t.close_reason === 'take_profit' ? 'take profit' : 'you closed it';
}

function movedBy(t: Trade): number {
  if (!t.exit_price || Number(t.entry_price) === 0) return 0;
  return (Number(t.exit_price) / Number(t.entry_price) - 1) * 100;
}

function notionalOf(t: Trade): number {
  return t.notional ? Number(t.notional) : Number(t.size) * Number(t.entry_price);
}

function returnOn(t: Trade): number {
  const margin = Number(t.collateral ?? 0);
  return margin > 0 ? (Number(t.pnl ?? 0) / margin) * 100 : 0;
}

function duration(t: Trade): string {
  const minutes = Math.max(1, Math.round((new Date(t.closed_at!).getTime() - new Date(t.opened_at).getTime()) / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Venue order ids are long; the card shows enough to match one. */
function shortID(id?: string): string {
  if (!id) return '—';
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

function useTrade(ready: boolean, id: string, strategy: string) {
  const [trade, setTrade] = useState<Trade | null>(null);
  const [problem, setProblem] = useState<'missing' | 'locked' | 'offline' | null>(null);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const first = setTimeout(() => {
      api
        .trade(id, strategy)
        .then((t) => alive && setTrade(t))
        .catch((e) => {
          if (!alive) return;
          if (e instanceof ApiError && e.code === 'no_trade') setProblem('missing');
          else setProblem(e instanceof ApiError && e.code === 'network' ? 'offline' : 'locked');
        });
    }, 0);
    return () => {
      alive = false;
      clearTimeout(first);
    };
  }, [ready, id, strategy]);
  return { trade, problem };
}
