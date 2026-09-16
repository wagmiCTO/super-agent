/**
 * Б2 — the strategy screen, as the design has it.
 *
 * One screen for all three strategies, because they differ in exactly two
 * places: what the line above the keys says, and whether a side is named for
 * you. Direction asks a question and both keys stay filled — the call is
 * yours. MA Cross and RSI light up for a few minutes and name a side; until
 * then the keys are outlines. They never move or resize, so the screen does
 * not jump under a finger that is already reaching for it.
 *
 * Above the fold: the chart, what the strategy says, the keys, and the one
 * line of what a tap opens. The chart takes whatever height the fold leaves
 * after the rest, so the keys sit at the same place on every phone. Below
 * the fold: the crowd on-chain, and this strategy's own history. Nothing
 * below the fold is needed to tap.
 *
 * With a position open the screen becomes that position — the same design
 * replaces the entry screen with the one number that matters while it runs.
 */

import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';

import { api, type Position, type State, type Trade } from '@/api/client';
import { INTERVALS, INTERVAL_LABELS, type ChartPosition, type ChartTick, type Interval } from '@/chart/page';
import { trim } from '@/components/format';
import { TVChart } from '@/components/TVChart';
import { DEFAULT_SYMBOL, STRATEGY_NAMES } from '@/config';
import { ContextPanel } from '@/strategy/context';
import { riskPercent } from '@/strategy/risk';
import { useSignal, type StrategyId } from '@/strategy/useSignal';
import { SettingsChip } from '@/trading/position-form';
import { maxLossFraction, takeProfitFraction, usePositionSettings } from '@/trading/useSettings';
import { useTrading } from '@/trading/useTrading';
import { Button, DirectionKeys } from '@/ui/button';
import { useCountdown } from '@/ui/countdown';
import { RiskDial } from '@/ui/mark';
import { Badge, Card, Chip, Screen } from '@/ui/surface';
import { Text, money } from '@/ui/text';
import { face, useTheme, useThemeControls } from '@/theme';

/** The design's own numbers for this screen, not tokens: they are the same in every skin. */
const TOP = 52; // where the header sits, under the status bar
const PEEK = 44; // how much of what is below the fold shows above it
const CHART_MIN = 260;

export function StrategyScreen({ id }: { id: StrategyId }) {
  const theme = useTheme();
  const { height } = useWindowDimensions();

  const t = useTrading(DEFAULT_SYMBOL, id);
  const signal = useSignal(id, DEFAULT_SYMBOL);
  const { settings } = usePositionSettings();

  const lit = signal?.side ?? null;
  const armed = id === 'direction';
  const tap = (side: 'up' | 'down') =>
    void t.open(
      side === 'up' ? 'long' : 'short',
      String(settings.size),
      settings.horizonMinutes * 60,
      maxLossFraction(settings),
      String(settings.leverage),
      takeProfitFraction(settings),
    );

  // When the position ends — by the tap below, or by the timer, the stop or
  // the target while this screen is up — the screen becomes the result. The
  // round trip is looked up by the order that closed it, or, when the
  // platform closed it, as the newest one closed since the position opened.
  const leaving = useRef(false);
  const goToResult = async (closeOrderID: string | null, openedAfter: string | null) => {
    if (leaving.current) return;
    leaving.current = true;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const trades = await api.trades(DEFAULT_SYMBOL, id);
        const done = trades.find((x) =>
          x.id && x.closed_at && (closeOrderID ? x.close_order_id === closeOrderID : !openedAfter || x.opened_at >= openedAfter),
        );
        if (done?.id) {
          router.replace({ pathname: '/result', params: { id: done.id, strategy: id } });
          return;
        }
      } catch {
        // asked again below
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    leaving.current = false;
  };
  const closeNow = async () => {
    const order = await t.close();
    if (order) void goToResult(order.venue_id, null);
  };
  const was = useRef<Position | null>(null);
  useEffect(() => {
    const before = was.current;
    was.current = t.position;
    if (before && !t.position && t.state) void goToResult(null, before.opened_at ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.position]);

  // One screen minus a peek of what is below: the fold is a promise that
  // everything needed to tap is above it, and a hint that more is under it.
  const fold = height - PEEK;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: theme.space.s5 }}>
        <View style={{ minHeight: fold, paddingTop: TOP, gap: theme.space.s4 }}>
          <Header id={id} state={t.state} offline={t.offline} locked={t.locked} symbol={t.position ? DEFAULT_SYMBOL : null} />

          <ChartBox id={id} lit={lit !== null} trades={t.trades} position={t.position} />

          {t.position ? null : <Says id={id} signal={signal} />}

          {/* What just happened stays on the screen whether or not it left a
              position: a fill is the answer to the tap that was made. */}
          {t.notice ? (
            <Card
              testID="notice"
              style={{ paddingVertical: theme.space.s3, ...(t.notice.kind === 'error' ? { backgroundColor: theme.color.dangerSoft } : null) }}
            >
              <Text variant="small" style={t.notice.kind === 'error' ? { color: theme.color.danger } : undefined}>
                {t.notice.text}
              </Text>
            </Card>
          ) : null}

          {t.position ? (
            <OpenPosition position={t.position} busy={t.busy === 'close'} onClose={() => void closeNow()} />
          ) : (
            // The keys and what a tap opens, on a rule that runs edge to edge:
            // the line under them is where the screen's promise ends.
            <View
              style={{
                marginHorizontal: -theme.space.s5,
                paddingHorizontal: theme.space.s5,
                paddingTop: theme.space.s3,
                paddingBottom: 12,
                gap: theme.space.s3,
                borderBottomWidth: theme.size.bw,
                borderBottomColor: theme.color.hair,
              }}
            >
              <DirectionKeys
                onPress={tap}
                recommended={lit === 'long' ? 'up' : lit === 'short' ? 'down' : null}
                alwaysArmed={armed}
                disabled={t.busy !== null || t.state === null}
              />
              <SettingsChip onPress={() => router.push('/settings')} />
            </View>
          )}
        </View>

        <View style={{ paddingTop: theme.space.s4, gap: theme.space.s4 }}>
          <ContextPanel symbol={DEFAULT_SYMBOL} />
          <HistoryCard id={id} trades={t.trades} />
        </View>
      </ScrollView>
    </Screen>
  );
}

/** ‹ Lobby · the strategy · where the money is · the day's risk · the lesson. */
function Header({ id, state, offline, locked, symbol }: { id: StrategyId; state: State | null; offline: boolean; locked: boolean; symbol: string | null }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.s3 }}>
      {/* The way back never shrinks; the title gives way instead, as the design has it. */}
      <Text variant="small" testID="lobby-link" numberOfLines={1} style={{ paddingVertical: theme.space.s2, flexShrink: 0 }} onPress={() => router.replace('/')}>
        ‹ Lobby
      </Text>
      <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: theme.type.tMd, flexShrink: 1 }}>
        {symbol ? `${STRATEGY_NAMES[id] ?? 'Direction'} · ${symbol}` : STRATEGY_NAMES[id] ?? 'Direction'}
      </Text>
      {/* The balance belongs to the lobby: here the header is the way back,
          what you are trading, and what the day has left in it. */}
      <Badge>{offline ? 'OFFLINE' : locked ? 'SIGN IN' : 'TESTNET'}</Badge>
      <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: theme.space.s2 }}>
        <Pressable onPress={() => router.push('/risk')} testID="risk-dial" accessibilityRole="button" accessibilityLabel="Risk and performance">
          <RiskDial percent={riskPercent(state)} />
        </Pressable>
        <Pressable
          testID="lesson-link"
          accessibilityRole="button"
          accessibilityLabel="Read the lesson again"
          onPress={() => router.push({ pathname: '/lesson', params: { strategy: id } })}
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            borderWidth: theme.size.bw,
            borderColor: theme.color.line,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text variant="small" style={{ fontSize: theme.type.tSm, lineHeight: theme.type.tSm * 1.2, color: theme.color.text2 }}>?</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * The chart, with the price on it and the two controls the datafeed can
 * honour: the bar size, and candles or a line. It fills whatever the fold
 * leaves after the keys and the header, and never less than a readable pane.
 */
function ChartBox({ id, lit, trades, position }: { id: StrategyId; lit: boolean; trades: Trade[]; position: Position | null }) {
  const theme = useTheme();
  const { name } = useThemeControls();
  const [line, setLine] = useState(false);
  const [interval, setInterval] = useState<Interval>('1');
  const [tick, setTick] = useState<ChartTick | null>(null);

  const glass = {
    backgroundColor: theme.color.glass,
    borderWidth: theme.size.bw,
    borderColor: theme.color.line,
  } as const;

  return (
    <View
      testID="signal-card"
      style={{
        flex: 1,
        minHeight: CHART_MIN,
        borderRadius: theme.radius.rXl,
        overflow: 'hidden',
        backgroundColor: theme.color.soft,
        borderWidth: lit ? 3 : 0,
        borderColor: lit ? theme.color.accent : 'transparent',
      }}
    >
      <TVChart
        symbol={DEFAULT_SYMBOL}
        theme={name === 'terminal' ? 'dark' : 'light'}
        colours={{
          background: theme.color.soft,
          up: theme.color.chartUp,
          down: theme.color.chartDown,
          accent: theme.color.accent,
          text: theme.color.muted,
          grid: theme.color.chartGrid,
          line: theme.color.chartLine,
        }}
        chartType={line ? 'line' : 'candles'}
        interval={interval}
        trend={position ? (position.side === 'long' ? 'up' : 'down') : 'flat'}
        ma={id === 'ma-cross' ? 21 : 0}
        study={id === 'rsi' ? 'rsi' : undefined}
        trades={trades}
        position={position ? levelsOf(position) : null}
        onTick={setTick}
      />

      {/* Top-left: the price, and how the day has treated it. */}
      <View pointerEvents="none" style={{ position: 'absolute', top: 12, left: 14 }}>
        <Text
          variant="num"
          testID="chart-price"
          style={{ fontSize: theme.type.t2xl, lineHeight: theme.type.t2xl, fontFamily: face(theme, 'num', 700), letterSpacing: theme.type.t2xl * -0.01 }}
        >
          {tick ? trim(tick.price) : ' '}
        </Text>
        <Text variant="small" style={{ fontSize: theme.type.tXs }}>
          {tick?.change === null || tick?.change === undefined ? DEFAULT_SYMBOL : `${DEFAULT_SYMBOL} · ${money(tick.change, 1)}% today`}
        </Text>
      </View>

      {/* Top-right: the bar size, and the shape of the series. */}
      <View style={{ position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: theme.space.s2 }}>
        <View style={{ flexDirection: 'row', gap: 2, padding: 3, borderRadius: theme.radius.rMd, ...glass }}>
          {INTERVALS.map((tf) => {
            const on = tf === interval;
            return (
              <Pressable
                key={tf}
                testID={`chart-tf-${INTERVAL_LABELS[tf]}`}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => setInterval(tf)}
                style={{ paddingVertical: 3, paddingHorizontal: 5, borderRadius: theme.radius.rSm, backgroundColor: on ? theme.color.accent : 'transparent' }}
              >
                <Text
                  style={{
                    fontFamily: face(theme, 'display', 600),
                    fontSize: theme.type.t2xs,
                    lineHeight: theme.type.t2xs * 1.3,
                    color: on ? theme.color.onAccent : theme.color.body,
                  }}
                >
                  {INTERVAL_LABELS[tf]}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          testID="chart-mode"
          accessibilityRole="button"
          accessibilityLabel={line ? 'Show candles' : 'Show a line'}
          onPress={() => setLine((v) => !v)}
          style={{ width: 30, height: 30, borderRadius: theme.radius.rMd, alignItems: 'center', justifyContent: 'center', ...glass }}
        >
          <Text style={{ fontFamily: face(theme, 'display', 700), fontSize: theme.type.tXs, color: theme.color.body }}>{line ? '∿' : '▮'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * The open position as the chart draws it: the entry, and the prices at
 * which the stop, the target and the venue end it. The platform states the
 * first two as results, so they are turned back into prices here, written
 * with the entry's own decimals.
 */
function levelsOf(p: Position): ChartPosition {
  const size = Number(p.size);
  const entry = Number(p.entry_price);
  const sign = p.side === 'long' ? 1 : -1;
  const decimals = (p.entry_price.split('.')[1] ?? '').length;
  const at = (pnl: string | undefined): string | undefined => {
    if (pnl === undefined || !(size > 0)) return undefined;
    return (entry + (sign * Number(pnl)) / size).toFixed(decimals);
  };
  return {
    side: p.side,
    size: p.size,
    entry_price: p.entry_price,
    unrealized_pnl: p.unrealized_pnl,
    stop_price: at(p.stop_pnl),
    tp_price: at(p.tp_pnl),
    liquidation_price: p.liquidation_price ? Number(p.liquidation_price).toFixed(decimals) : undefined,
  };
}

/** What the strategy has to say: a question, or a side, or silence with a reason. */
function Says({ id, signal }: { id: StrategyId; signal: ReturnType<typeof useSignal> }) {
  const theme = useTheme();
  const { settings } = usePositionSettings();
  const left = useCountdown(signal?.expiresAt ?? null);

  if (id === 'direction') {
    return (
      <Text variant="bodyStrong" style={{ textAlign: 'center', fontSize: theme.type.tMd, fontFamily: face(theme, 'display', 700) }} testID="says">
        {`Where does ${DEFAULT_SYMBOL} go in the next ${settings.horizonMinutes} minutes?`}
      </Text>
    );
  }

  if (signal?.side) {
    return (
      <View
        testID="signal-lit"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space.s3,
          paddingHorizontal: theme.space.s4,
          paddingVertical: theme.space.s3,
          borderRadius: theme.radius.rLg,
          backgroundColor: theme.color.accent,
        }}
      >
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.color.onAccent }} />
        <View style={{ flex: 1, gap: 1 }}>
          <Text variant="bodyStrong" style={{ fontSize: theme.type.tLg, color: theme.color.onAccent }}>
            {`SIGNAL · ${signal.side === 'long' ? 'UP' : 'DOWN'}`}
          </Text>
          <Text variant="small" style={{ fontSize: theme.type.tXs, color: theme.color.onAccentDim }}>{signal.detail}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="num" style={{ fontSize: theme.type.tLg, fontFamily: face(theme, 'num', 700), color: theme.color.onAccent }}>
            {left ?? '—'}
          </Text>
          <Text variant="small" style={{ fontSize: theme.type.t2xs, color: theme.color.onAccentDim }}>window</Text>
        </View>
      </View>
    );
  }

  return (
    <View
      testID="signal-waiting"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space.s2,
        paddingHorizontal: theme.space.s4,
        paddingVertical: theme.space.s3,
        borderRadius: theme.radius.rLg,
        borderWidth: theme.size.bw,
        borderStyle: 'dashed',
        borderColor: theme.color.line,
      }}
    >
      <Text variant="body" numberOfLines={1} style={{ flex: 1, fontSize: theme.type.tXs }}>
        <Text variant="bodyStrong" style={{ fontSize: theme.type.tSm }}>No signal now</Text>
        {` · ${signal?.quiet ?? 'reading the market…'}`}
      </Text>
      {signal?.last ? <Text variant="small" numberOfLines={1} style={{ fontSize: theme.type.t2xs }}>{signal.last}</Text> : null}
    </View>
  );
}

/**
 * A position, while it runs.
 *
 * The design replaces the entry screen with this: the one number, what it is
 * doing, when it ends by itself, and the only button that matters.
 */
function OpenPosition({ position, busy, onClose }: { position: Position; busy: boolean; onClose: () => void }) {
  const theme = useTheme();
  const left = useCountdown(position.closes_at ?? null);
  const pnl = Number(position.unrealized_pnl);
  const colour = pnl > 0.005 ? theme.color.up : pnl < -0.005 ? theme.color.down : theme.color.ink;
  const run = elapsedShare(position);

  return (
    <View style={{ gap: theme.space.s3 }}>
      <View
        testID="open-position"
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          padding: theme.space.s4,
          borderRadius: theme.radius.rXl,
          backgroundColor: theme.color.soft,
        }}
      >
        <View style={{ gap: theme.space.s1, flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space.s2, flexWrap: 'wrap' }}>
            <Text variant="bodyStrong" style={{ fontSize: theme.type.tMd, color: position.side === 'long' ? theme.color.up : theme.color.down }}>
              {position.side === 'long' ? 'Up' : 'Down'}
            </Text>
            <Text variant="num" style={{ fontSize: theme.type.tMd, fontFamily: face(theme, 'num', 700) }}>{`${Number(position.notional).toFixed(2)} AUSD`}</Text>
            <Text variant="num" style={{ fontSize: theme.type.tMd, fontFamily: face(theme, 'num', 700), color: theme.color.accent }}>{`${position.leverage}x`}</Text>
          </View>
          <Text variant="body" style={{ fontSize: theme.type.tMd }}>
            {pnl > 0.005 ? 'You are up' : pnl < -0.005 ? 'You are down' : 'Flat so far'}
          </Text>
          {/* One line, always: a result that wraps stops being one number. */}
          <Text
            variant="num"
            testID="big-number"
            numberOfLines={1}
            adjustsFontSizeToFit
            style={{ fontSize: theme.type.tHero, fontFamily: face(theme, 'num', 700), lineHeight: theme.type.tHero * 1.05, color: colour }}
          >
            {money(pnl)}
          </Text>
          <Text variant="small" testID="position-footer">
            {`AUSD · in at ${trim(position.entry_price)} · fees ${trim(position.fees_paid)}`}
          </Text>
        </View>
        {left ? (
          <View style={{ alignItems: 'flex-end', gap: theme.space.s1 }}>
            <Text variant="small">Closes in</Text>
            <Text variant="num" style={{ fontSize: theme.type.t2xl, lineHeight: theme.type.t2xl, fontFamily: face(theme, 'num', 700) }}>{left}</Text>
            {run !== null ? (
              <View style={{ width: 90, height: 6, borderRadius: 999, backgroundColor: theme.color.hair, overflow: 'hidden' }}>
                <View style={{ height: 6, width: `${Math.round(run * 100)}%`, backgroundColor: theme.color.accent }} />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      <Text variant="small" testID="position-rules">
        {`${
          position.stop_pnl !== undefined
            ? `Stops by itself at ${money(Number(position.stop_pnl))} AUSD (${stopAgainst(position).toFixed(1)}% against you).`
            : 'No stop: the time limit is the exit.'
        }${position.tp_pnl !== undefined ? ` Takes profit at ${money(Number(position.tp_pnl))}.` : ''} Liquidation is ${(100 / Math.max(1, Number(position.leverage))).toFixed(1)}% away.`}
      </Text>

      <Button testID="close-position" title="Close now" variant="outline" busy={busy} disabled={busy} onPress={onClose} />
    </View>
  );
}

/** How much of the horizon has run, 0..1, or null without one. */
function elapsedShare(p: Position): number | null {
  if (!p.closes_at || !p.opened_at) return null;
  const total = new Date(p.closes_at).getTime() - new Date(p.opened_at).getTime();
  if (total <= 0) return null;
  const gone = Date.now() - new Date(p.opened_at).getTime();
  return Math.min(1, Math.max(0, gone / total));
}

/** How far the price may go against the position before the stop fires. */
function stopAgainst(p: Position): number {
  const notional = Number(p.notional);
  return notional > 0 ? (Math.abs(Number(p.stop_pnl ?? 0)) / notional) * 100 : 0;
}

/** This strategy's own round trips, and the fills behind them. */
function HistoryCard({ id, trades }: { id: StrategyId; trades: Trade[] }) {
  const theme = useTheme();
  const [tab, setTab] = useState<'positions' | 'orders'>('positions');
  const rows = trades.slice(0, 3);

  return (
    <Card testID="history" style={{ gap: theme.space.s2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.s2 }}>
        <Chip label="Positions" on={tab === 'positions'} onPress={() => setTab('positions')} testID="history-positions" />
        <Chip label="Orders" on={tab === 'orders'} onPress={() => setTab('orders')} testID="history-orders" />
        <Pressable testID="history-all" accessibilityRole="link" onPress={() => router.push('/history')} style={{ marginLeft: 'auto', paddingVertical: theme.space.s1 }}>
          <Text variant="small">All history ›</Text>
        </Pressable>
      </View>
      {rows.length === 0 ? (
        <Text variant="small" style={{ paddingVertical: 8 }}>{`No trades yet in ${STRATEGY_NAMES[id] ?? 'Direction'}.`}</Text>
      ) : tab === 'positions' ? (
        rows.map((t) => <TradeRow key={t.opened_at} trade={t} strategy={id} />)
      ) : (
        rows.flatMap((t) => orderRows(t)).map((o) => <OrderRow key={o.key} title={o.title} sub={o.sub} to={o.to} />)
      )}
    </Card>
  );
}

/** One round trip; a closed one opens the card that reports it, as the history does. */
function TradeRow({ trade, strategy }: { trade: Trade; strategy: string }) {
  const theme = useTheme();
  const pnl = Number(trade.pnl ?? '0');
  const to = trade.id && trade.closed_at ? { pathname: '/trade/[id]' as const, params: { id: trade.id, strategy } } : null;
  return (
    <Pressable
      testID="history-position"
      accessibilityRole={to ? 'button' : undefined}
      disabled={!to}
      onPress={to ? () => router.push(to) : undefined}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        borderTopWidth: theme.size.bw,
        borderTopColor: theme.color.hair,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 1 }}>
        <Text variant="body" style={{ fontSize: theme.type.tSm }}>
          {`${trade.side === 'long' ? 'Up' : 'Down'} · ${trim(trade.entry_price)}${trade.exit_price ? ` → ${trim(trade.exit_price)}` : ' · open'}`}
        </Text>
        <Text variant="small" style={{ fontSize: theme.type.t2xs }}>{`${hm(trade.opened_at)} – ${hm(trade.closed_at ?? trade.opened_at)} · ${reason(trade)}`}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.s2 }}>
        <Text variant="num" signOf={pnl} style={{ fontFamily: face(theme, 'num', 700) }}>
          {trade.pnl === undefined ? '—' : money(pnl)}
        </Text>
        {to ? <Text variant="small" style={{ fontSize: theme.type.t2xs }}>›</Text> : null}
      </View>
    </Pressable>
  );
}

type OrderLink = { pathname: '/trade/[id]'; params: { id: string; strategy: string; order: 'open' | 'close' } } | null;

function OrderRow({ title, sub, to }: { title: string; sub: string; to: OrderLink }) {
  const theme = useTheme();
  return (
    <Pressable
      testID="history-order"
      accessibilityRole={to ? 'button' : undefined}
      disabled={!to}
      onPress={to ? () => router.push(to) : undefined}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        borderTopWidth: theme.size.bw,
        borderTopColor: theme.color.hair,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 1 }}>
        <Text variant="body" style={{ fontSize: theme.type.tSm }}>{title}</Text>
        <Text variant="small" style={{ fontSize: theme.type.t2xs }}>{sub}</Text>
      </View>
      <Text variant="small" style={{ fontSize: theme.type.t2xs }}>{to ? 'filled ›' : 'filled'}</Text>
    </Pressable>
  );
}

/** A round trip is two fills: the exit is the news, so it comes first. */
function orderRows(t: Trade): { key: string; title: string; sub: string; to: OrderLink }[] {
  const side = t.side === 'long' ? 'Up' : 'Down';
  const id = t.opened_at;
  const link = (order: 'open' | 'close'): OrderLink => (t.id ? { pathname: '/trade/[id]', params: { id: t.id, strategy: t.strategy, order } } : null);
  const open = { key: `${id}-open`, title: `Open ${side} · @ ${trim(t.entry_price)}`, sub: `${hm(t.opened_at)} · fee ${trim(t.entry_fee)}`, to: link('open') };
  if (!t.closed_at) return [open];
  // The exit is the news, so it comes first.
  return [
    { key: `${id}-close`, title: `Close ${side} · @ ${trim(t.exit_price ?? '0')}`, sub: `${hm(t.closed_at)} · fee ${trim(t.exit_fee ?? '0')}`, to: link('close') },
    open,
  ];
}

function reason(t: Trade): string {
  if (t.close_reason === 'horizon') return 'by timer';
  if (t.close_reason === 'stop') return 'stop';
  if (t.close_reason === 'take_profit') return 'take profit';
  if (t.close_reason === 'manual') return 'closed';
  return 'open';
}

function hm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
