/**
 * The result: what one round trip made, the moment it ended.
 *
 * The design replaces the position screen with this when the trade closes —
 * by the timer, by the stop, by the target or by hand — so the number
 * arrives on its own screen instead of as a line under the keys. From here:
 * back to the lobby, share it, or tap again.
 *
 * The tone follows the result. A win gets the room: the number in the up
 * colour on its own tinted ground, a headline that says it, the streak when
 * there is one. A loss is told plainly and quietly — the number in ink, not
 * in red, and a line about what kept it small — because a screen that
 * shouts "You lost" at someone who just did is not one they open twice.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useAccount } from '@/account/useAccount';
import { api, ApiError, type Standings, type Trade } from '@/api/client';
import { STRATEGY_NAMES } from '@/config';
import { trim } from '@/components/format';
import { shareTrade } from '@/trading/share';
import { useRiskReport } from '@/trading/useRiskReport';
import { Bone } from '@/ui/anim';
import { Button } from '@/ui/button';
import { Card, Row, Screen } from '@/ui/surface';
import { Text, lineBox, money } from '@/ui/text';
import { useBottom, useTop } from '@/ui/inset';
import { useTheme } from '@/theme';

const ROUTES = { direction: '/direction', 'ma-cross': '/ma-cross', rsi: '/rsi' } as const;

export default function ResultScreen() {
  const theme = useTheme();
  const top = useTop(16);
  const bottom = useBottom(theme.space.s6);
  const { id, strategy: raw } = useLocalSearchParams<{ id: string; strategy?: string }>();
  const strategy = raw ?? 'direction';
  const knows = useAccount().state.status !== 'loading';
  const trade = useClosedTrade(knows, String(id), strategy);
  const report = useRiskReport(knows);
  const standing = useStanding(knows, strategy);

  const pnl = trade && trade !== 'missing' ? Number(trade.pnl ?? 0) : 0;
  const week = report?.totals.week ?? null;
  const won = pnl > 0.005;
  const lost = pnl < -0.005;
  // The week's streak counts this trade once the journal has it; a run of
  // wins is worth saying, a run of losses is not.
  const streak = won && week && week.streak >= 2 ? week.streak : 0;
  const [shared, setShared] = useState<string | null>(null);
  const share = async () => {
    if (!trade || trade === 'missing') return;
    const out = await shareTrade(
      {
        kind: 'closed',
        strategy: trade.strategy,
        symbol: trade.symbol,
        side: trade.side,
        notional: trade.notional ? Number(trade.notional) : Number(trade.size) * Number(trade.entry_price),
        leverage: trade.leverage ? String(Number(trade.leverage)) : '1',
        pnl,
        movePct: movedBy(trade),
        reason: kicker(trade).toLowerCase(),
        rank: standing?.you ? { place: standing.you.rank, of: standing.players } : null,
      },
      theme,
    );
    setShared(out === 'copied' ? 'Copied — paste it anywhere' : out === 'shared' ? 'Shared' : null);
  };

  return (
    <Screen testID="result">
      <View style={{ flex: 1, paddingTop: top, paddingBottom: bottom, justifyContent: 'space-between', gap: theme.space.s4 }}>
        <View style={{ gap: theme.space.s5 }}>
          {trade === null ? (
            <View style={{ gap: theme.space.s3 }}>
              <Bone width={120} height={12} />
              <Bone width={200} height={40} radius={8} />
              <Bone width={240} height={60} radius={8} />
            </View>
          ) : trade === 'missing' ? (
            <Text variant="small" testID="result-problem">That trade is not on this wallet.</Text>
          ) : (
            <>
              <Text variant="caps" style={{ color: won ? theme.color.up : theme.color.muted }} testID="result-kicker">{kicker(trade)}</Text>
              <View
                style={
                  won
                    ? {
                        marginHorizontal: -theme.space.s5,
                        paddingHorizontal: theme.space.s5,
                        paddingVertical: theme.space.s5,
                        borderRadius: theme.radius.rXl,
                        backgroundColor: theme.color.up + '14',
                      }
                    : undefined
                }
              >
                <Text variant="h1" style={{ fontSize: theme.type.t3xl, lineHeight: lineBox('display', theme.type.t3xl) }}>
                  {won ? 'Nice call.' : lost ? 'Not this time.' : 'Break even.'}
                </Text>
                <Text
                  variant="hero"
                  testID="result-pnl"
                  style={{ color: won ? theme.color.up : theme.color.ink, fontSize: won ? theme.type.tMega * 1.15 : theme.type.tMega, lineHeight: lineBox('num', won ? theme.type.tMega * 1.15 : theme.type.tMega) }}
                >
                  {money(pnl)}
                </Text>
                <Text variant="small" style={{ fontSize: theme.type.tMd, marginTop: theme.space.s2, color: won ? theme.color.body : theme.color.muted }} testID="result-line">
                  {`AUSD · ${trade.symbol} ${movedBy(trade) >= 0 ? 'up' : 'down'} ${Math.abs(movedBy(trade)).toFixed(2)}% in ${duration(trade)} · fees ${fees(trade).toFixed(2)}`}
                </Text>
                {streak > 0 ? (
                  <Text variant="bodyStrong" style={{ marginTop: theme.space.s3, color: theme.color.up }} testID="result-streak">
                    {`${streak} in a row this week`}
                  </Text>
                ) : null}
              </View>
              {/* The trade, and nothing else: what it was, where it went in
                  and out, how long it ran, what it cost, who ended it. The
                  week and the board have their own screens. */}
              <Card testID="result-facts">
                <Row label="Trade" value={`${trade.side === 'long' ? 'Up' : 'Down'} on ${trade.symbol} · ${sized(trade)} AUSD${trade.leverage ? ` at ${Number(trade.leverage)}x` : ''}`} />
                <Row label="In → out" value={`${trim(trade.entry_price)} → ${trade.exit_price ? trim(trade.exit_price) : '—'}`} />
                <Row label="Held" value={duration(trade)} />
                <Row label="Fees" value={`${fees(trade).toFixed(4)} AUSD`} />
                {trade.best_pnl !== undefined || trade.worst_pnl !== undefined ? (
                  <Row label="Best · worst" value={`${money(Number(trade.best_pnl ?? 0))} · ${money(Number(trade.worst_pnl ?? 0))}`} />
                ) : null}
                <Row label="Closed by" value={closedBy(trade)} />
              </Card>
              <Text variant="body" style={{ color: theme.color.body }}>{moral(trade, won)}</Text>
            </>
          )}
        </View>

        <View style={{ gap: theme.space.s3 }}>
          {/* Two equal ways on: the lobby, or straight back to the strategy. */}
          <View style={{ flexDirection: 'row', gap: theme.space.s3 }}>
            <View style={{ flex: 1 }}>
              <Button testID="result-lobby" title="Back to lobby" variant="outline" onPress={() => router.replace('/')} />
            </View>
            <View style={{ flex: 1 }}>
              <Button testID="result-again" title="Tap again" onPress={() => router.replace(ROUTES[strategy as keyof typeof ROUTES] ?? '/direction')} />
            </View>
          </View>
          <Text variant="body" testID="result-share" style={{ textAlign: 'center', paddingVertical: theme.space.s2 }} onPress={() => void share()}>
            {shared ?? 'Share'}
          </Text>
        </View>
      </View>
    </Screen>
  );
}

/** Who ended it, in words for the facts card. */
function closedBy(t: Trade): string {
  switch (t.close_reason) {
    case 'horizon':
      return 'the timer';
    case 'stop':
      return 'the stop';
    case 'take_profit':
      return 'the target';
    default:
      return 'you';
  }
}

/** The position's value, as it was opened. */
function sized(t: Trade): string {
  const n = t.notional ? Number(t.notional) : Number(t.size) * Number(t.entry_price);
  return n.toFixed(2);
}

/** Who ended it, in the design's capitals. */
function kicker(t: Trade): string {
  switch (t.close_reason) {
    case 'horizon':
      return 'TIME IS UP';
    case 'stop':
      return 'STOPPED';
    case 'take_profit':
      return 'TAKE PROFIT';
    default:
      return 'YOU CLOSED IT';
  }
}

/** One line to take away, by how it ended and whether it paid. */
function moral(t: Trade, won: boolean): string {
  const pnl = Number(t.pnl ?? 0);
  switch (t.close_reason) {
    case 'stop':
      return 'The stop did its job: that was the most this tap could lose, and the next one starts clean.';
    case 'take_profit':
      return 'The target did the closing: the win was banked before the time ran out.';
    case 'horizon':
      return won
        ? 'Right side, right time. The clock closed it for you.'
        : `The clock closed it. A ${Math.abs(pnl).toFixed(2)} lesson, not a dent: the day's budget is what keeps it that way.`;
    default:
      return won
        ? `Closed by hand, in the green. ${STRATEGY_NAMES[t.strategy] ?? 'The strategy'} is ready for the next one.`
        : `Closed by hand. Small ones like this are the cost of finding the ones that pay.`;
  }
}

function movedBy(t: Trade): number {
  if (!t.exit_price || Number(t.entry_price) === 0) return 0;
  return (Number(t.exit_price) / Number(t.entry_price) - 1) * 100;
}

function fees(t: Trade): number {
  return Number(t.entry_fee) + Number(t.exit_fee ?? 0);
}

function duration(t: Trade): string {
  if (!t.closed_at) return '—';
  const seconds = Math.max(0, Math.round((new Date(t.closed_at).getTime() - new Date(t.opened_at).getTime()) / 1000));
  if (seconds < 60) return 'under a minute';
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

/**
 * The round trip, once the journal has it closed. The close that led here
 * lands in the journal a moment after the venue fills it, so the first read
 * may still find it open; it is asked again until it is not.
 */
function useClosedTrade(ready: boolean, id: string, strategy: string): Trade | 'missing' | null {
  const [trade, setTrade] = useState<Trade | 'missing' | null>(null);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    let attempts = 0;
    const read = () => {
      api
        .trade(id, strategy)
        .then((t) => {
          if (!alive) return;
          if (t.closed_at || attempts >= 10) setTrade(t);
          else {
            attempts += 1;
            setTimeout(read, 1000);
          }
        })
        .catch((e) => {
          if (!alive) return;
          if (e instanceof ApiError && e.code === 'no_trade') setTrade('missing');
          else if (attempts < 10) {
            attempts += 1;
            setTimeout(read, 1000);
          }
        });
    };
    const first = setTimeout(read, 0);
    return () => {
      alive = false;
      clearTimeout(first);
    };
  }, [ready, id, strategy]);
  return trade;
}

/** Where this wallet stands on the strategy's board this week. */
function useStanding(ready: boolean, strategy: string): Standings | null {
  const [standing, setStanding] = useState<Standings | null>(null);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const first = setTimeout(() => {
      api
        .standings(strategy, 'week', 0, 1)
        .then((s) => alive && setStanding(s))
        .catch(() => undefined);
    }, 0);
    return () => {
      alive = false;
      clearTimeout(first);
    };
  }, [ready, strategy]);
  return standing;
}
