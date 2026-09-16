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
import { Share, View } from 'react-native';

import { useAccount } from '@/account/useAccount';
import { api, ApiError, type Standings, type Trade } from '@/api/client';
import { APP_NAME, STRATEGY_NAMES } from '@/config';
import { useRiskReport } from '@/trading/useRiskReport';
import { Bone } from '@/ui/anim';
import { Button } from '@/ui/button';
import { Card, Row, Screen } from '@/ui/surface';
import { Text, money } from '@/ui/text';
import { useTheme } from '@/theme';

const ROUTES = { direction: '/direction', 'ma-cross': '/ma-cross', rsi: '/rsi' } as const;

export default function ResultScreen() {
  const theme = useTheme();
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

  return (
    <Screen testID="result">
      <View style={{ flex: 1, paddingTop: 56, paddingBottom: theme.space.s6, justifyContent: 'space-between', gap: theme.space.s4 }}>
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
                <Text variant="h1" style={{ fontSize: theme.type.t3xl, lineHeight: theme.type.t3xl * 1.15 }}>
                  {won ? 'Nice call.' : lost ? 'Not this time.' : 'Break even.'}
                </Text>
                <Text
                  variant="hero"
                  testID="result-pnl"
                  style={{ color: won ? theme.color.up : theme.color.ink, fontSize: won ? theme.type.tMega * 1.15 : theme.type.tMega, lineHeight: (won ? theme.type.tMega * 1.15 : theme.type.tMega) * 1.02 }}
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
              <Card>
                <Row
                  label="Your week"
                  value={week ? `${week.trades} ${week.trades === 1 ? 'trade' : 'trades'} · ${money(Number(week.pnl))} AUSD` : '…'}
                  tone={week ? Number(week.pnl) : undefined}
                />
                <Row label="Leaderboard" value={standing ? (standing.you ? `#${standing.you.rank} of ${standing.players}` : `${standing.players} on the board`) : '…'} />
                <Row label="Pool closes" value="Sunday" />
              </Card>
              <Text variant="body" style={{ color: theme.color.body }}>{moral(trade, won)}</Text>
            </>
          )}
        </View>

        <View style={{ gap: theme.space.s3 }}>
          <Button testID="result-lobby" title="Back to lobby" onPress={() => router.replace('/')} />
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: theme.space.s6 }}>
            <Text
              variant="body"
              testID="result-share"
              style={{ paddingVertical: theme.space.s2 }}
              onPress={() => {
                if (trade && trade !== 'missing') {
                  void Share.share({ message: `${trade.side === 'long' ? 'Up' : 'Down'} on ${trade.symbol} · ${money(pnl)} AUSD · ${APP_NAME}` }).catch(() => undefined);
                }
              }}
            >
              Share
            </Text>
            <Text variant="body" testID="result-again" style={{ paddingVertical: theme.space.s2 }} onPress={() => router.replace(ROUTES[strategy as keyof typeof ROUTES] ?? '/direction')}>
              Tap again
            </Text>
          </View>
        </View>
      </View>
    </Screen>
  );
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
