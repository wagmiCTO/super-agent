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
 * line of what a tap opens. Below it: the crowd on-chain, and this strategy's
 * own history. Nothing below the fold is needed to tap.
 *
 * With a position open the screen becomes that position — the same design
 * replaces the entry screen with the one number that matters while it runs.
 */

import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View, useColorScheme, useWindowDimensions } from 'react-native';

import type { Position, State, Trade } from '@/api/client';
import { trim } from '@/components/format';
import { TVChart } from '@/components/TVChart';
import { DEFAULT_SYMBOL, STRATEGY_NAMES } from '@/config';
import { ContextPanel } from '@/strategy/context';
import { riskPercent } from '@/strategy/risk';
import { useSignal, type StrategyId } from '@/strategy/useSignal';
import { SettingsChip } from '@/trading/position-form';
import { maxLossFraction, usePositionSettings } from '@/trading/useSettings';
import { useTrading } from '@/trading/useTrading';
import { Button, DirectionKeys } from '@/ui/button';
import { useCountdown } from '@/ui/countdown';
import { RiskDial } from '@/ui/mark';
import { Badge, Card, Chip, Screen } from '@/ui/surface';
import { Text, money } from '@/ui/text';
import { face, useTheme } from '@/theme';

export function StrategyScreen({ id }: { id: StrategyId }) {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const { height } = useWindowDimensions();

  const t = useTrading(DEFAULT_SYMBOL, id);
  const signal = useSignal(id, DEFAULT_SYMBOL);
  const { settings } = usePositionSettings();
  const [line, setLine] = useState(false);

  const lit = signal?.side ?? null;
  const armed = id === 'direction';
  const tap = (side: 'up' | 'down') =>
    void t.open(
      side === 'up' ? 'long' : 'short',
      String(settings.size),
      settings.horizonMinutes * 60,
      maxLossFraction(settings),
      String(settings.leverage),
    );

  // One screen minus a peek of what is below: the fold is a promise that
  // everything needed to tap is above it, and a hint that more is under it.
  const fold = height - 44;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: theme.space.s6 }}>
        <View style={{ minHeight: fold, paddingTop: 52, paddingHorizontal: theme.space.s5, gap: theme.space.s4 }}>
          <Header id={id} state={t.state} offline={t.offline} locked={t.locked} />

          <ChartBox
            id={id}
            lit={lit !== null}
            dark={dark}
            line={line}
            onLine={() => setLine((v) => !v)}
            trades={t.trades}
            position={t.position}
          />

          {/* What just happened stays on the screen whether or not it left a
              position: a fill is the answer to the tap that was made. */}
          {t.notice ? (
            <Card testID="notice" style={t.notice.kind === 'error' ? { backgroundColor: theme.color.dangerSoft } : undefined}>
              <Text variant="small" style={t.notice.kind === 'error' ? { color: theme.color.danger } : undefined}>
                {t.notice.text}
              </Text>
            </Card>
          ) : null}

          {t.position ? (
            <OpenPosition position={t.position} busy={t.busy === 'close'} onClose={() => void t.close()} />
          ) : (
            <>
              <Says id={id} signal={signal} />
              <View style={{ gap: theme.space.s3, paddingBottom: theme.space.s3, borderBottomWidth: theme.size.bw, borderBottomColor: theme.color.hair }}>
                <DirectionKeys
                  onPress={tap}
                  recommended={lit === 'long' ? 'up' : lit === 'short' ? 'down' : null}
                  alwaysArmed={armed}
                  disabled={t.busy !== null || t.state === null}
                />
                <SettingsChip onPress={() => router.push('/settings')} />
              </View>
            </>
          )}
        </View>

        <View style={{ paddingHorizontal: theme.space.s5, paddingTop: theme.space.s4, gap: theme.space.s4 }}>
          <ContextPanel symbol={DEFAULT_SYMBOL} />
          <HistoryCard id={id} trades={t.trades} />
          {t.state ? (
            <Text variant="small" style={{ textAlign: 'center', fontSize: theme.type.t2xs }}>
              {`Up to ${t.state.limits.max_notional} per position · ${t.state.limits.max_leverage}x · today's loss ${trim(t.state.risk.daily_loss)} of ${t.state.limits.daily_loss}`}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

/** ‹ Lobby · the strategy · where the money is · the day's risk · the lesson. */
function Header({ id, state, offline, locked }: { id: StrategyId; state: State | null; offline: boolean; locked: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.s2 }}>
      <Text variant="small" testID="lobby-link" numberOfLines={1} onPress={() => router.replace('/')}>‹ Lobby</Text>
      <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: theme.type.tMd }}>{STRATEGY_NAMES[id] ?? 'Direction'}</Text>
      <View style={{ flex: 1 }} />
      {/* The balance belongs to the lobby: here the header is the way back,
          what you are trading, and what the day has left in it. */}
      <Badge>{offline ? 'OFFLINE' : locked ? 'SIGN IN' : 'TESTNET'}</Badge>
      <Pressable onPress={() => router.push('/risk')} testID="risk-dial" accessibilityRole="button" accessibilityLabel="Risk and performance">
        <RiskDial percent={riskPercent(state)} />
      </Pressable>
      <Pressable
        testID="lesson-link"
        accessibilityRole="button"
        accessibilityLabel="Read the lesson again"
        onPress={() => router.push({ pathname: '/lesson', params: { strategy: id } })}
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          borderWidth: theme.size.bw,
          borderColor: theme.color.line,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text variant="small" style={{ fontSize: theme.type.t2xs }}>?</Text>
      </Pressable>
    </View>
  );
}

/**
 * The chart, with the price on it and the one control the datafeed can
 * honour. Timeframes are not offered: the platform serves one-minute candles
 * and only one-minute candles, and chips that all draw the same chart would
 * be decoration.
 */
function ChartBox({
  id, lit, dark, line, onLine, trades, position,
}: {
  id: StrategyId;
  lit: boolean;
  dark: boolean;
  line: boolean;
  onLine: () => void;
  trades: Trade[];
  position: Position | null;
}) {
  const theme = useTheme();
  return (
    <View
      testID="signal-card"
      style={{
        height: 320,
        borderRadius: theme.radius.rXl,
        overflow: 'hidden',
        backgroundColor: theme.color.soft,
        borderWidth: lit ? 3 : 0,
        borderColor: lit ? theme.color.accent : 'transparent',
      }}
    >
      <TVChart
        symbol={DEFAULT_SYMBOL}
        theme={dark ? 'dark' : 'light'}
        background={theme.color.soft}
        chartType={line ? 'line' : 'candles'}
        trend={position ? (position.side === 'long' ? 'up' : 'down') : 'flat'}
        ma={id === 'ma-cross' ? 21 : 0}
        study={id === 'rsi' ? 'rsi' : undefined}
        trades={trades}
        position={position}
        height={320}
      />
      {/* Top-left: the library draws its own price scale down the right edge,
          and a control sitting on it reads as part of the chart's furniture. */}
      <Pressable
        testID="chart-mode"
        accessibilityRole="button"
        accessibilityLabel={line ? 'Show candles' : 'Show a line'}
        onPress={onLine}
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          width: 30,
          height: 30,
          borderRadius: theme.radius.rMd,
          backgroundColor: theme.color.glass,
          borderWidth: theme.size.bw,
          borderColor: theme.color.line,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text variant="small" style={{ fontSize: theme.type.tXs, color: theme.color.body }}>{line ? '∿' : '▮'}</Text>
      </Pressable>
    </View>
  );
}

/** What the strategy has to say: a question, or a side, or silence with a reason. */
function Says({ id, signal }: { id: StrategyId; signal: ReturnType<typeof useSignal> }) {
  const theme = useTheme();
  const { settings } = usePositionSettings();
  const left = useCountdown(signal?.expiresAt ?? null);

  if (id === 'direction') {
    return (
      <Text variant="bodyStrong" style={{ textAlign: 'center', fontSize: theme.type.tMd }} testID="says">
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
            <Text variant="num" style={{ fontSize: theme.type.t2xl, fontFamily: face(theme, 'num', 700) }}>{left}</Text>
          </View>
        ) : null}
      </View>

      <Text variant="small">
        {position.stop_pnl !== undefined
          ? `Stops by itself at ${trim(position.stop_pnl)} AUSD.`
          : 'No stop: the time limit is the exit.'}
      </Text>

      <Button testID="close-position" title="Close now" variant="outline" busy={busy} disabled={busy} onPress={onClose} />
    </View>
  );
}

/** This strategy's own round trips, and the fills behind them. */
function HistoryCard({ id, trades }: { id: StrategyId; trades: Trade[] }) {
  const theme = useTheme();
  const [tab, setTab] = useState<'positions' | 'orders'>('positions');
  const rows = trades.slice(0, 3);

  return (
    <Card testID="history">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.s2 }}>
        <Chip label="Positions" on={tab === 'positions'} onPress={() => setTab('positions')} testID="history-positions" />
        <Chip label="Orders" on={tab === 'orders'} onPress={() => setTab('orders')} testID="history-orders" />
      </View>
      {rows.length === 0 ? (
        <Text variant="small">{`No trades yet in ${STRATEGY_NAMES[id] ?? 'Direction'}.`}</Text>
      ) : tab === 'positions' ? (
        rows.map((t) => <TradeRow key={t.opened_at} trade={t} />)
      ) : (
        rows.flatMap((t) => orderRows(t)).map((o) => <OrderRow key={o.key} title={o.title} sub={o.sub} />)
      )}
    </Card>
  );
}

function TradeRow({ trade }: { trade: Trade }) {
  const theme = useTheme();
  const pnl = Number(trade.pnl ?? '0');
  return (
    <View
      testID="history-position"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: theme.space.s2,
        borderTopWidth: theme.size.bw,
        borderTopColor: theme.color.hair,
      }}
    >
      <View style={{ flex: 1, gap: 1 }}>
        <Text variant="body" style={{ fontSize: theme.type.tSm }}>
          {`${trade.side === 'long' ? 'Up' : 'Down'} · ${trim(trade.entry_price)}${trade.exit_price ? ` → ${trim(trade.exit_price)}` : ' · open'}`}
        </Text>
        <Text variant="small" style={{ fontSize: theme.type.t2xs }}>{`${hm(trade.opened_at)} – ${hm(trade.closed_at ?? trade.opened_at)} · ${reason(trade)}`}</Text>
      </View>
      <Text variant="num" signOf={pnl} style={{ fontFamily: face(theme, 'num', 700) }}>
        {trade.pnl === undefined ? '—' : `${pnl >= 0 ? '+' : ''}${trim(trade.pnl)}`}
      </Text>
    </View>
  );
}

function OrderRow({ title, sub }: { title: string; sub: string }) {
  const theme = useTheme();
  return (
    <View
      testID="history-order"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: theme.space.s2,
        borderTopWidth: theme.size.bw,
        borderTopColor: theme.color.hair,
      }}
    >
      <View style={{ flex: 1, gap: 1 }}>
        <Text variant="body" style={{ fontSize: theme.type.tSm }}>{title}</Text>
        <Text variant="small" style={{ fontSize: theme.type.t2xs }}>{sub}</Text>
      </View>
      <Text variant="small" style={{ fontSize: theme.type.t2xs }}>filled</Text>
    </View>
  );
}

/** A round trip is two fills: the exit is the news, so it comes first. */
function orderRows(t: Trade): { key: string; title: string; sub: string }[] {
  const side = t.side === 'long' ? 'Up' : 'Down';
  const id = t.opened_at;
  const open = { key: `${id}-open`, title: `Open ${side} · @ ${trim(t.entry_price)}`, sub: `${hm(t.opened_at)} · fee ${trim(t.entry_fee)}` };
  if (!t.closed_at) return [open];
  // The exit is the news, so it comes first.
  return [
    { key: `${id}-close`, title: `Close ${side} · @ ${trim(t.exit_price ?? '0')}`, sub: `${hm(t.closed_at)} · fee ${trim(t.exit_fee ?? '0')}` },
    open,
  ];
}

function reason(t: Trade): string {
  if (t.close_reason === 'horizon') return 'by timer';
  if (t.close_reason === 'stop') return 'stop';
  if (t.close_reason === 'manual') return 'closed';
  return 'open';
}

function hm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
