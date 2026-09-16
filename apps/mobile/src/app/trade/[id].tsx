/**
 * One round trip, reported — and the same screen for one of its two orders.
 *
 * As the design has it: what it was and who closed it, what it made and what
 * that is of the money put in, then the report — how far the market moved,
 * what the position was made of, where the stop stood, the worst and the
 * best it was worth, and the fees. No chart: the card is a report, and a
 * drawn line of a move already in the numbers adds nothing.
 *
 * Rows the platform did not record for this trade say so with a dash. Old
 * round trips have no leverage, no stop and no excursion — they were
 * journaled before the columns existed, and a card that invents them would
 * be a card that lies about money.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

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
                <Row label="Side · size" value={`${up(trade)} · ${trim(trade.size)} ${trade.symbol}${trade.notional ? ` · ${Number(trade.notional).toFixed(2)} AUSD` : ''}`} />
                <Row label="Price" value={`${trim((order === 'close' ? trade.exit_price : trade.entry_price) ?? '0')} · market`} />
                <Row label="Fee" value={`${Number((order === 'close' ? trade.exit_fee : trade.entry_fee) ?? 0).toFixed(2)} AUSD`} />
                <Row label="Filled" value={when((order === 'close' ? trade.closed_at : trade.opened_at) ?? '')} />
                {/* The way to the round trip, once there is one to show.
                    While the position is open there is no trade to report,
                    so the order is the whole of it. */}
                {trade.closed_at ? (
                  <Text
                    variant="small"
                    testID="to-trade"
                    onPress={() => router.replace({ pathname: '/trade/[id]', params: { id: String(id), strategy: trade.strategy } })}
                    style={{ color: theme.color.accent, paddingTop: theme.space.s1 }}
                  >
                    {`The trade · closed ${when(trade.closed_at)} · ${money(Number(trade.pnl ?? 0))} ›`}
                  </Text>
                ) : null}
              </Card>
            ) : (
              <Card style={{ gap: theme.space.s1 }} testID="trade-report">
                {/* "Moved" rather than "MON moved": the symbol is on the
                    size row, and the label wrapped to two lines. */}
                <Row label="Moved" value={moved(trade)} tone={movedBy(trade)} />
                <Row label="Size" value={size(trade)} />
                <Row label="Stop" value={trade.stop_pnl ? money(Number(trade.stop_pnl)) : 'off'} />
                <Row label="Worst moment" value={trade.worst_pnl ? money(Number(trade.worst_pnl)) : '—'} tone={trade.worst_pnl ? Number(trade.worst_pnl) : undefined} />
                <Row label="Best moment" value={trade.best_pnl ? money(Number(trade.best_pnl)) : '—'} tone={trade.best_pnl ? Number(trade.best_pnl) : undefined} />
                <Row label="Fees" value={`${Number(trade.entry_fee).toFixed(2)} + ${Number(trade.exit_fee ?? 0).toFixed(2)}`} />
              </Card>
            )}

            {!asOrder && (trade.worst_pnl === undefined || trade.best_pnl === undefined) ? (
              <Text variant="small" style={{ fontSize: theme.type.t2xs }} testID="trade-gap">
                The worst and best moments are read while the position is open; this one closed before the platform watched for them.
              </Text>
            ) : null}

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
  const onCollateral = trade.collateral && Number(trade.collateral) > 0 ? (pnl / Number(trade.collateral)) * 100 : null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: theme.space.s3 }}>
      <View style={{ flexShrink: 1 }}>
        <Text variant="caps" testID="trade-what">
          {`${STRATEGY_NAMES[trade.strategy] ?? trade.strategy} · ${up(trade)} · ${reason(trade)}`}
        </Text>
        <Text variant="hero" signOf={pnl} style={{ marginTop: theme.space.s2 }} testID="trade-pnl">{money(pnl)}</Text>
        <Text variant="small" style={{ fontSize: theme.type.tSm }}>{`AUSD · ${span(trade)}`}</Text>
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

/** One side of it, as the exchange filled it. */
function OrderHead({ trade, side }: { trade: Trade; side: 'open' | 'close' }) {
  const theme = useTheme();
  const price = (side === 'close' ? trade.exit_price : trade.entry_price) ?? '0';
  const at = (side === 'close' ? trade.closed_at : trade.opened_at) ?? '';
  return (
    <View style={{ gap: theme.space.s2 }}>
      <Text variant="caps" testID="order-what">{`${side === 'close' ? 'Close' : 'Open'} · ${up(trade)} · ${STRATEGY_NAMES[trade.strategy] ?? trade.strategy}`}</Text>
      <Text variant="numLarge" testID="order-price">{trim(price)}</Text>
      <Text variant="small" style={{ fontSize: theme.type.tSm }}>{`${trade.symbol} · ${when(at)}`}</Text>
    </View>
  );
}

function up(t: Trade): string {
  return t.side === 'long' ? 'Up' : 'Down';
}

function reason(t: Trade): string {
  if (!t.closed_at) return 'open now';
  return t.close_reason === 'horizon' ? 'by timer' : t.close_reason === 'stop' ? 'stopped' : 'you closed it';
}

/** How far the market went, in percent and in prices. */
function moved(t: Trade): string {
  if (!t.exit_price) return `${trim(t.entry_price)} → open`;
  const by = movedBy(t);
  return `${by > 0 ? '+' : ''}${by.toFixed(2)}% · ${trim(t.entry_price)} → ${trim(t.exit_price)}`;
}

function movedBy(t: Trade): number {
  if (!t.exit_price || Number(t.entry_price) === 0) return 0;
  return (Number(t.exit_price) / Number(t.entry_price) - 1) * 100;
}

/** What the position was made of, in the design's words. */
function size(t: Trade): string {
  const notional = t.notional ? Number(t.notional) : Number(t.size) * Number(t.entry_price);
  const head = t.collateral && t.leverage ? `${Number(t.collateral).toFixed(2)} × ${trim(t.leverage)}x = ${notional.toFixed(2)}` : `${notional.toFixed(2)} AUSD`;
  return `${head} · ${trim(t.size)} ${t.symbol}`;
}

function span(t: Trade): string {
  if (!t.closed_at) return `open since ${when(t.opened_at)}`;
  const minutes = Math.max(1, Math.round((new Date(t.closed_at).getTime() - new Date(t.opened_at).getTime()) / 60000));
  return `${when(t.opened_at)} – ${when(t.closed_at)} · ${minutes} min`;
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
