/**
 * Б2 — the strategy screen, as the design has it.
 *
 * One screen for all three strategies, because they differ in exactly two
 * places: what the line above the keys says, and whether a side is named for
 * you. Direction asks a question and both keys stay filled — the call is
 * yours. MA Cross and RSI light up for a few bars and name a side; until
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
import { ActivityIndicator, Pressable, ScrollView, Vibration, View, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useAccount } from '@/account/useAccount';
import { api, type ErrorCode, type Position, type State, type Trade } from '@/api/client';
import { INTERVALS, INTERVAL_LABELS, type ChartPosition, type ChartTick, type Interval } from '@/chart/page';
import { Pager, slice } from '@/ui/pager';
import { ConfirmSheet } from '@/ui/sheet';
import { ExitsSheet, type ExitsChange } from '@/trading/exits-sheet';
import { AnalysisSheet } from '@/strategy/analysis-sheet';
import { loadAnalysisDay, saveAnalysisDay } from '@/strategy/analysis-store';
import { todayKey } from '@/strategy/today';
import { useRiskReport } from '@/trading/useRiskReport';
import { trim } from '@/components/format';
import { TVChart } from '@/components/TVChart';
import { STRATEGY_NAMES, SYMBOLS } from '@/config';
import { ContextPanel } from '@/strategy/context';
import { riskPercent, riskPercentOf } from '@/strategy/risk';
import { useSignal, type Signal, type StrategyId } from '@/strategy/useSignal';
import { SettingsChip } from '@/trading/position-form';
import { shareTrade } from '@/trading/share';
import { clearSignalEntry, markSignalEntry, wasSignalEntry } from '@/trading/signal-entry';
import { maxLossFraction, maxSizeFor, takeProfitFraction, usePositionSettings } from '@/trading/useSettings';
import { useSymbol } from '@/trading/useSymbol';
import { useTrading, type Busy } from '@/trading/useTrading';
import { Button, DirectionKeys } from '@/ui/button';
import { useCountdown } from '@/ui/countdown';
import { useTop } from '@/ui/inset';
import { RiskDial } from '@/ui/mark';
import { Badge, Card, Chip, Screen } from '@/ui/surface';
import { Text, lineBox, money } from '@/ui/text';
import { face, useTheme, useThemeControls } from '@/theme';

/** The design's own numbers for this screen, not tokens: they are the same in every skin. */
const PEEK = 44; // how much of what is below the fold shows above it
const CHART_MIN = 260;
/** RSI only: the share of the chart box the lower pane takes, as the design draws it. */
const RSI_PANE = 0.27;

/**
 * The phone says it in the hand: a signal lighting up, and an entry taken
 * on one. Two patterns, so the second is recognisably the answer to the
 * first. Not every phone can — a browser on iOS has no vibration — and
 * then it says nothing, quietly.
 */
function buzz(kind: 'signal' | 'entry') {
  try {
    Vibration.vibrate(kind === 'signal' ? [0, 90, 70, 90] : [0, 40, 40, 40, 40, 160]);
  } catch {
    // no vibration here
  }
}

/** A window that opened this recently is news; an older one was already on the screen. */
const FRESH_MS = 20_000;


/** How far a finger travels before it is a swipe and not a press. */

/**
 * Refusals the trader can lift themselves, and where.
 *
 * Every one of these is a number the wallet chose in the danger zone, so the
 * notice that reports it also offers the way there, pointed at the row that
 * made the call. A code that is not here is nobody's setting — the venue's
 * own answer, or a market that is closed — and gets no button.
 */
const LIMIT_FIX: Partial<Record<ErrorCode, { title: string; focus: string }>> = {
  too_many_open_positions: { title: 'Open at once · change it in Risk', focus: 'open-positions' },
  daily_loss_limit_reached: { title: 'Daily loss budget · change it in Risk', focus: 'daily-loss' },
  cooldown: { title: 'Cooldown between taps · change it in Risk', focus: 'cooldown' },
};

/**
 * The two swipes, shown rather than written.
 *
 * Neither gesture leaves anything on the screen, and a card explaining them
 * is a card to be read and dismissed. So the screen takes both swipes
 * itself, once: the chart pane travels and comes back, and a breath later
 * the whole screen does. Nothing changes — the point is where the finger
 * goes, not where it arrives.
 *
 * `markSeen` is called after the second one, so a visit that was cut short
 * gets the demonstration again.
 */
export function StrategyScreen({ id }: { id: StrategyId }) {
  const theme = useTheme();
  const { height } = useWindowDimensions();
  const TOP = useTop();

  // The market this screen is on: the one its position is in while one
  // runs, the one last chosen otherwise. One account holds one position per
  // market whatever the strategy, and the platform says whose each is, so
  // the screen never guesses: a position of this strategy is shown here
  // whatever market the menu was left on, and a market another strategy
  // holds is offered greyed out. The choice is remembered per strategy,
  // and a position's market becomes the choice, so closing it leaves the
  // screen where the trade was.
  const [chosen, chooseSymbol] = useSymbol(id);
  const t = useTrading(chosen, id);
  const symbol = t.position?.symbol ?? chosen;
  useEffect(() => {
    if (t.position && t.position.symbol !== chosen) chooseSymbol(t.position.symbol);
  }, [t.position, chosen, chooseSymbol]);
  // The chart's bar size, which is also the signal's: the strategy reads
  // the same lines the chart draws.
  const [interval, setInterval] = useState<Interval>('1');
  const signal = useSignal(id, symbol, interval);
  const { bounds, update, forMarket } = usePositionSettings();
  // The standard position as this market reads it: its own leverage.
  const settings = forMarket(symbol);

  const allowed = t.state?.limits.allowed_symbols ?? null;
  // The majors first, in the order the design names them, then whatever
  // else the venue lists, so a new market shows up without a release.
  const offered = allowed ? [...SYMBOLS.filter((s) => allowed.includes(s)), ...allowed.filter((s) => !(SYMBOLS as readonly string[]).includes(s)).sort()] : [...SYMBOLS];
  // Who holds a market, when it is not this strategy: the name to grey it out with.
  const heldBy = (s: string): string | null => {
    const p = t.positions.find((x) => x.symbol === s && x !== t.position);
    if (!p) return null;
    return p.strategy ? STRATEGY_NAMES[p.strategy] ?? p.strategy : 'another strategy';
  };
  // Left on a market another strategy has since taken: move to the first
  // free one. A tap here would not open a second position, it would add to
  // theirs — the account holds one per market.
  const taken = !t.position && heldBy(symbol) !== null;
  useEffect(() => {
    if (!taken) return;
    const free = offered.find((s) => heldBy(s) === null);
    if (free && free !== symbol) chooseSymbol(free);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taken, symbol, t.positions]);
  // Every chart this screen can show, in the order a swipe walks them: the
  // free markets at this bar size, then the same markets at the next one.
  // A market another strategy holds is not in the list, as the menu greys
  // it out; with a position open the market is settled and the walk is the
  // bar sizes alone, so the trade can still be looked at up close.
  const tradable = offered.filter((s) => heldBy(s) === null || s === symbol);
  const charts: { symbol: string; interval: Interval }[] = INTERVALS.flatMap((tf) =>
    (t.position ? [symbol] : tradable).map((s) => ({ symbol: s, interval: tf })),
  );
  const atChart = charts.findIndex((c) => c.symbol === symbol && c.interval === interval);
  const stepChart = (dir: 1 | -1) => {
    if (charts.length < 2) return;
    const next = charts[(Math.max(0, atChart) + dir + charts.length) % charts.length];
    if (next.symbol !== symbol) chooseSymbol(next.symbol);
    if (next.interval !== interval) setInterval(next.interval);
  };

  const lit = signal?.side ?? null;
  const armed = id === 'direction';
  // A window that has just opened is announced in the hand. One that was
  // already open when the screen arrived, or that another timeframe shows,
  // was news then, not now.
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!signal?.openedAt || !lit) return;
    const key = `${symbol}:${interval}:${signal.openedAt}`;
    if (announced.current === key) return;
    announced.current = key;
    if (Date.now() - new Date(signal.openedAt).getTime() < FRESH_MS) buzz('signal');
  }, [signal?.openedAt, lit, symbol, interval]);

  // Never above what this market allows: the settings already cap each
  // market at its own ceiling, and the venue refuses a leverage it does
  // not offer, so the market's own number is the last word.
  const marketMax = t.market ? Number(t.market.max_leverage) : 0;
  const leverage = marketMax > 0 ? Math.min(settings.leverage, marketMax) : settings.leverage;
  // What the tap needs from the free balance — the margin and the opening
  // fee — against what is there, so a tap that the venue would refuse is
  // never offered: the screen says so first, and offers the size that fits.
  const free = t.state ? Number(t.state.account.balance) : bounds.balance;
  const need = settings.size / Math.max(1, leverage) + settings.size * bounds.openFee;
  const short = t.state !== null && !t.position && need > free + 0.005;
  const fits = Math.floor(maxSizeFor({ ...bounds, balance: free }, leverage));
  // How many positions the wallet allows itself at once, and how many it is
  // already using. Said before the tap rather than after the refusal: the
  // keys are dead either way, and a screen that explains itself first does
  // not need the venue to say no.
  const maxOpen = t.state?.limits.max_open_positions ?? 0;
  const openNow = t.state?.risk.open_positions ?? 0;
  const atLimit = t.state !== null && !t.position && maxOpen > 0 && openNow >= maxOpen;
  // Whether the last refusal was one the trader can lift, and where.
  const noticeFix = t.notice?.code ? LIMIT_FIX[t.notice.code] : undefined;

  const open = (side: 'up' | 'down') => {
    // A tap on a lit signal is remembered as such: the position card says
    // it caught the signal, and the hand is told.
    if (lit !== null) {
      markSignalEntry(id, symbol);
      buzz('entry');
    } else {
      clearSignalEntry(id);
    }
    void t.open(
      side === 'up' ? 'long' : 'short',
      String(settings.size),
      settings.horizonMinutes * 60,
      maxLossFraction(settings),
      String(leverage),
      takeProfitFraction(settings),
    );
  };
  // A signal strategy with nothing lit does not refuse the tap; it asks.
  const [asking, setAsking] = useState<'up' | 'down' | null>(null);
  const tap = (side: 'up' | 'down') => {
    if (!armed && lit === null) setAsking(side);
    else open(side);
  };

  // When the position ends — by the tap below, or by the timer, the stop or
  // the target while this screen is up — the screen becomes the result. The
  // round trip is looked up by the order that closed it, or, when the
  // platform closed it, as the newest one closed since the position opened.
  const leaving = useRef(false);
  // The moment between the close and the result: the position is gone
  // and the round trip is being looked up. The screen says so rather
  // than showing the keys for a second and then leaving.
  const [settling, setSettling] = useState(false);
  const goToResult = async (closeOrderID: string | null, openedAfter: string | null) => {
    if (leaving.current) return;
    leaving.current = true;
    setSettling(true);
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const trades = await api.trades(symbol, id);
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
    setSettling(false);
  };
  const closeNow = async () => {
    const order = await t.close();
    if (order) void goToResult(order.venue_id, null);
  };
  // Reversing is a close and an open in one; the moment in between is
  // not a round trip to report, so it does not lead to the result.
  const [reversing, setReversing] = useState<Position | null>(null);
  const reverse = async () => {
    setReversing(null);
    clearSignalEntry(id);
    await t.reverse();
  };
  const was = useRef<Position | null>(null);
  useEffect(() => {
    const before = was.current;
    was.current = t.position;
    if (before && !t.position && t.state && t.busy !== 'reverse') {
      clearSignalEntry(id);
      void goToResult(null, before.opened_at ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.position]);

  // The day's analysis, once a day, on the first strategy screen opened:
  // asked for on arrival, and remembered as read the moment it is closed.
  const [analysis, setAnalysis] = useState(false);
  useEffect(() => {
    let alive = true;
    loadAnalysisDay().then((day) => {
      if (alive && day !== todayKey()) setAnalysis(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  const closeAnalysis = () => {
    setAnalysis(false);
    void saveAnalysisDay(todayKey());
  };

  // One screen minus a peek of what is below: the fold is a promise that
  // everything needed to tap is above it, and a hint that more is under it.
  const fold = height - PEEK;


  return (
    // The side margin belongs to the content here, not to the screen: the
    // list would clip anything drawn outside its own frame, and the chart's
    // two step keys stand out in that margin.
    <Screen style={{ paddingHorizontal: 0 }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: theme.space.s5 }}>
        <View style={{ minHeight: fold, paddingTop: TOP, paddingHorizontal: theme.space.s5, gap: theme.space.s4 }}>
          <Header id={id} state={t.state} offline={t.offline} locked={t.locked} symbol={t.position ? symbol : null} />

          <ChartBox
            id={id}
            symbol={symbol}
            markets={t.position ? null : { offered, heldBy, choose: chooseSymbol }}
            charts={{ at: Math.max(0, atChart), of: charts.length, step: stepChart }}
            interval={interval}
            onInterval={setInterval}
            lit={lit !== null}
            trades={t.trades}
            position={t.position}
            signal={signal}
          />

          {t.position ? null : <Says id={id} symbol={symbol} signal={signal} />}

          {/* What just happened stays on the screen whether or not it left a
              position: a fill is the answer to the tap that was made. And a
              refusal that a limit made carries the way to that limit: the
              number is the wallet's own, so saying no without saying where
              to change it is only half the answer. */}
          {t.notice ? (
            <Card
              testID="notice"
              style={{ paddingVertical: theme.space.s3, gap: theme.space.s2, ...(t.notice.kind === 'error' ? { backgroundColor: theme.color.dangerSoft } : null) }}
            >
              <Text variant="small" style={t.notice.kind === 'error' ? { color: theme.color.danger } : undefined}>
                {t.notice.text}
              </Text>
              {noticeFix ? (
                <Button
                  testID="notice-fix"
                  title={noticeFix.title}
                  variant="outline"
                  small
                  onPress={() => router.push({ pathname: '/risk', params: { focus: noticeFix.focus } })}
                />
              ) : null}
            </Card>
          ) : null}

          {t.position ? (
            <OpenPosition
              position={t.position}
              busy={t.busy}
              onClose={() => void closeNow()}
              onReverse={() => setReversing(t.position)}
              onAmend={t.amend}
              strategy={id}
              onSignal={!armed && wasSignalEntry(id, t.position.symbol)}
            />
          ) : settling || t.busy === 'reverse' ? (
            // Between two states of the account: the position has just
            // gone and the next thing — the result, or the other side —
            // is on its way. Said in words, with the keys kept back.
            <Card testID="settling" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.s3, paddingVertical: theme.space.s4 }}>
              <ActivityIndicator color={theme.color.accent} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">{t.busy === 'reverse' ? 'Reversing' : 'Closed'}</Text>
                <Text variant="small">{t.busy === 'reverse' ? 'Closed at market; opening the other side in a moment…' : 'Looking up the result…'}</Text>
              </View>
            </Card>
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
                disabled={t.busy !== null || t.state === null || taken || short || atLimit}
                busy={t.busy === 'up' || t.busy === 'down' ? t.busy : null}
              />
              {atLimit ? (
                <Card testID="position-limit" style={{ paddingVertical: theme.space.s3, gap: theme.space.s2, backgroundColor: theme.color.dangerSoft, borderColor: 'transparent' }}>
                  <Text variant="small" style={{ color: theme.color.danger }}>
                    {`${openNow} ${openNow === 1 ? 'position is' : 'positions are'} open and your limit is ${maxOpen} at once. Close one to open another — or raise the limit, it is yours to set.`}
                  </Text>
                  <Button
                    testID="position-limit-fix"
                    title="Open at once · change it in Risk"
                    variant="outline"
                    small
                    onPress={() => router.push({ pathname: '/risk', params: { focus: 'open-positions' } })}
                  />
                </Card>
              ) : short ? (
                <Card testID="short-balance" style={{ paddingVertical: theme.space.s3, gap: theme.space.s2, backgroundColor: theme.color.dangerSoft, borderColor: 'transparent' }}>
                  <Text variant="small" style={{ color: theme.color.danger }}>
                    {`Not enough free balance: ${settings.size} AUSD at ${leverage}x needs ${need.toFixed(2)}, and ${free.toFixed(2)} is free.`}
                  </Text>
                  {fits >= bounds.minSize ? (
                    <Button
                      testID="short-balance-fix"
                      title={`Open up to ${fits} AUSD instead`}
                      variant="outline"
                      small
                      onPress={() => update({ size: fits })}
                    />
                  ) : (
                    <Text variant="small" style={{ color: theme.color.danger }}>Close a position or add funds to open another.</Text>
                  )}
                </Card>
              ) : null}
              <SettingsChip onPress={() => router.push({ pathname: '/settings', params: { symbol } })} symbol={symbol} />
            </View>
          )}

          <ConfirmSheet
            open={asking !== null}
            title="No signal right now"
            body={`${STRATEGY_NAMES[id] ?? 'The strategy'} has not named a side. You can still open ${asking === 'up' ? 'Up' : 'Down'} on ${symbol} — it is your call, not the signal's.`}
            confirm={`Open ${asking === 'up' ? 'Up' : 'Down'} anyway`}
            cancel="Wait for the signal"
            onConfirm={() => {
              const side = asking;
              setAsking(null);
              if (side) open(side);
            }}
            onCancel={() => setAsking(null)}
            testID="no-signal"
          />

          <AnalysisSheet open={analysis} symbol={symbol} current={id} onClose={closeAnalysis} />

          <ConfirmSheet
            open={reversing !== null}
            title={`Reverse to ${reversing?.side === 'long' ? 'Down' : 'Up'}?`}
            body={`Closes this ${reversing?.side === 'long' ? 'Up' : 'Down'} at market and, a moment later, opens ${reversing?.side === 'long' ? 'Down' : 'Up'} on ${symbol}: ${Number(reversing?.notional ?? 0).toFixed(0)} AUSD at ${Number(reversing?.leverage ?? 1)}x, with the same stop, target and time limit.`}
            confirm={`Reverse to ${reversing?.side === 'long' ? 'Down' : 'Up'}`}
            cancel="Keep it"
            onConfirm={() => void reverse()}
            onCancel={() => setReversing(null)}
            testID="reverse"
          />
        </View>

        {/* Under the fold, and part of the same screen. */}
        <View style={{ paddingTop: theme.space.s4, paddingHorizontal: theme.space.s5, gap: theme.space.s4 }}>
          <ContextPanel symbol={symbol} />
          <HistoryCard id={id} trades={t.trades} />
        </View>
      </ScrollView>
    </Screen>
  );
}

/** ‹ Lobby · the strategy · where the money is · the day's risk · the lesson. */
function Header({ id, state, offline, locked, symbol }: { id: StrategyId; state: State | null; offline: boolean; locked: boolean; symbol: string | null }) {
  const theme = useTheme();
  const signedIn = useAccount().state.status === 'unlocked';
  // The dial is the wallet's, not this strategy's: a strategy the wallet
  // has no key for has no state, and its dial must not read calm for it.
  const report = useRiskReport(true);
  const percent = riskPercentOf(report) ?? riskPercent(state);
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
      {/* The locked badge is an instruction, so it is also the way to carry it
          out. Which instruction depends on what is missing: a wallet the app
          cannot sign for needs the passkey, one the exchange has no key for
          needs the account opened. Both were a dead chip that read as a
          button — every request here is answered for nobody until one of them
          is done. */}
      {!offline && locked ? (
        signedIn ? (
          <Badge testID="open-account-badge" accessibilityLabel="Open your account on the exchange" onPress={() => router.push('/enable')}>
            OPEN
          </Badge>
        ) : (
          <Badge testID="sign-in-badge" accessibilityLabel="Sign in with your passkey" onPress={() => router.push('/passkey')}>
            SIGN IN
          </Badge>
        )
      ) : (
        <Badge>{offline ? 'OFFLINE' : 'TESTNET'}</Badge>
      )}
      <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: theme.space.s2 }}>
        <Pressable onPress={() => router.push('/risk')} testID="risk-dial" accessibilityRole="button" accessibilityLabel="Risk and performance">
          <RiskDial percent={percent} />
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
 * The chart, with the price on it and the controls the datafeed can honour:
 * the market, the bar size, and candles or a line. It fills whatever the
 * fold leaves after the keys and the header, and never less than a
 * readable pane.
 *
 * The top band of the pane is the app's: one row of keys — the market on
 * the left, the bar sizes and the shape of the series on the right — and
 * under it the price and how the day has treated it.
 *
 * The pane itself is one long walk: every market this strategy is free to
 * trade at this bar size, then the same markets at the next one. A swipe
 * across it takes a step, and so do the two keys standing in the screen's
 * side margins. The pane takes every touch, so the chart under it is a
 * drawing rather than something to drag — the bar sizes and the market are
 * how this app moves around a chart.
 */
type Markets = { offered: string[]; heldBy: (s: string) => string | null; choose: (s: string) => void };

/** Where the walk is along the charts, how long it is, and how to take a step. */
type Charts = { at: number; of: number; step: (dir: 1 | -1) => void };

function ChartBox({
  id,
  symbol,
  markets,
  charts,
  interval,
  onInterval,
  lit,
  trades,
  position,
  signal,
}: {
  id: StrategyId;
  symbol: string;
  markets: Markets | null;
  charts: Charts;
  interval: Interval;
  onInterval: (i: Interval) => void;
  lit: boolean;
  trades: Trade[];
  position: Position | null;
  signal: Signal | null;
}) {
  const theme = useTheme();
  const [picking, setPicking] = useState(false);
  const averages = id === 'ma-cross' ? signal?.averages ?? { fast: 5, slow: 20, trend: 'flat' as const, lastCross: null } : null;
  const { name } = useThemeControls();
  const [line, setLine] = useState(false);
  const [tick, setTick] = useState<ChartTick | null>(null);
  const left = useCountdown(signal?.expiresAt ?? null);

  // The walk is stepped with the two keys at the screen's edges, and only
  // with them. A sideways drag used to do it too, and it fought everything
  // it shared the screen with: the list under it, the stack's own way back,
  // and the grips in the danger zone.
  const step = (dir: 1 | -1) => {
    setPicking(false);
    charts.step(dir);
  };
  const glass = {
    backgroundColor: theme.color.glass,
    borderWidth: theme.size.bw,
    borderColor: theme.color.line,
  } as const;

  return (
    // The pane, and beside it the two step keys. They stand outside the pane
    // rather than on it: the pane clips its own children to its corners, and
    // a key drawn inside it covers the bars it is there to change.
    <View style={{ flex: 1, minHeight: CHART_MIN }}>
      <View
        testID="signal-card"
        style={{
          flex: 1,
          borderRadius: theme.radius.rXl,
          overflow: 'hidden',
          backgroundColor: theme.color.soft,
          borderWidth: lit ? 3 : 0,
          borderColor: lit ? theme.color.accent : 'transparent',
        }}
      >
        <TVChart
          symbol={symbol}
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
          averages={averages ? { fast: averages.fast, slow: averages.slow } : undefined}
          cross={averages?.lastCross ?? null}
          study={id === 'rsi' ? 'rsi' : undefined}
          studyShare={id === 'rsi' ? RSI_PANE : undefined}
          trades={trades}
          position={position ? levelsOf(position) : null}
          onTick={setTick}
        />

        {/* The pane's own surface: the row of keys and the price at the top of
            it, the two steps along the walk at its sides, and everywhere else
            the swipe that takes the same step. It covers the chart, which is
            therefore a drawing rather than something to drag — the bar sizes
            and the market are how this app moves around a chart. */}
        <View testID="chart-band" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
          <View style={{ position: 'absolute', top: 10, left: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: theme.space.s2 }}>
            <Pressable
              testID="symbol-picker"
              accessibilityRole="button"
              accessibilityLabel="Choose the market"
              accessibilityState={{ expanded: picking, disabled: !markets }}
              disabled={!markets}
              onPress={() => setPicking((v) => !v)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                height: 30,
                paddingLeft: 10,
                paddingRight: markets ? 8 : 10,
                borderRadius: theme.radius.rMd,
                ...glass,
                borderColor: picking ? theme.color.accent : theme.color.line,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ fontFamily: face(theme, 'display', 700), fontSize: theme.type.tSm, lineHeight: theme.type.tSm * 1.2, color: theme.color.ink }}>{symbol}</Text>
              {markets ? (
                <Text style={{ fontFamily: face(theme, 'display', 700), fontSize: theme.type.tXs, lineHeight: theme.type.tXs * 1.2, color: theme.color.accent }}>{picking ? '▴' : '▾'}</Text>
              ) : null}
            </Pressable>
            <View style={{ flex: 1 }} />
            <View style={{ flexDirection: 'row', gap: 2, padding: 3, borderRadius: theme.radius.rMd, ...glass }}>
              {INTERVALS.map((tf) => {
                const on = tf === interval;
                return (
                  <Pressable
                    key={tf}
                    testID={`chart-tf-${INTERVAL_LABELS[tf]}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => onInterval(tf)}
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

          {picking ? null : (
            <View pointerEvents="none" style={{ position: 'absolute', top: 50, left: 14, flexDirection: 'row', alignItems: 'baseline', gap: theme.space.s2 }}>
              <Text
                variant="num"
                testID="chart-price"
                style={{ fontSize: theme.type.t2xl, lineHeight: lineBox('num', theme.type.t2xl), fontFamily: face(theme, 'num', 700), letterSpacing: theme.type.t2xl * -0.01 }}
              >
                {tick ? trim(tick.price) : ' '}
              </Text>
              <Text variant="small" style={{ fontSize: theme.type.tXs }}>
                {tick?.change === null || tick?.change === undefined ? '' : `${money(tick.change, 1)}% today`}
              </Text>
            </View>
          )}

          {/* Where the walk has got to, above the pane's own time axis. */}
          {charts.of > 1 ? (
            <View pointerEvents="none" style={{ position: 'absolute', bottom: 34, left: 0, right: 0, alignItems: 'center' }}>
              <View style={{ paddingVertical: 2, paddingHorizontal: 8, borderRadius: theme.radius.rSm, ...glass }}>
                <Text variant="small" testID="chart-walk" style={{ fontSize: theme.type.t2xs, lineHeight: theme.type.t2xs * 1.4 }}>
                  {`${symbol} · ${INTERVAL_LABELS[interval]} · ${charts.at + 1}/${charts.of}`}
                </Text>
              </View>
            </View>
          ) : null}

        </View>

        {/* The market menu, under its key. A grid of keys rather than a column:
            the venue lists seven markets and the chart box is the height it is,
            so a column would run off its bottom edge. */}
        {markets && picking ? (
          <View
            testID="symbol-menu"
            style={{ position: 'absolute', top: 46, left: 10, padding: 6, borderRadius: theme.radius.rMd, gap: 4, maxWidth: 236, ...glass, ...(theme.shadow.lift ? { boxShadow: theme.shadow.lift } : null) }}
          >
            <Text variant="small" style={{ fontSize: theme.type.t2xs, letterSpacing: 0.6, paddingHorizontal: 4, paddingTop: 2 }}>MARKET · swipe to turn</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              {markets.offered.map((s) => {
                const holder = markets.heldBy(s);
                const on = s === symbol;
                return (
                  <Pressable
                    key={s}
                    testID={`symbol-${s}`}
                    accessibilityRole="button"
                    accessibilityLabel={holder ? `${s}, in ${holder}` : s}
                    accessibilityState={{ selected: on, disabled: holder !== null }}
                    disabled={holder !== null}
                    onPress={() => {
                      markets.choose(s);
                      setPicking(false);
                    }}
                    style={({ pressed }) => ({
                      minWidth: 68,
                      paddingVertical: 6,
                      paddingHorizontal: 10,
                      borderRadius: theme.radius.rSm,
                      borderWidth: theme.size.bw,
                      borderColor: on ? theme.color.accent : theme.color.line,
                      backgroundColor: on ? theme.color.accent : 'transparent',
                      opacity: holder ? 0.45 : pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ fontFamily: face(theme, 'display', 700), fontSize: theme.type.tSm, lineHeight: theme.type.tSm * 1.2, color: on ? theme.color.onAccent : theme.color.ink }}>
                      {on ? `${s} ✓` : s}
                    </Text>
                    {holder ? (
                      <Text variant="small" numberOfLines={1} style={{ fontSize: theme.type.t2xs, lineHeight: theme.type.t2xs * 1.3 }}>{`in ${holder}`}</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* RSI only, as the design draws it: the crowd thermometer down the
            left of the price pane — 70 at the top, 30 at the bottom, the
            zones shaded, the index as a mark — and the lower pane's name at
            its top edge, with the zone and the window while one is lit. */}
        {id === 'rsi' && !picking ? (
          <>
            <View pointerEvents="none" testID="rsi-thermometer" style={{ position: 'absolute', left: 14, top: 96, bottom: `${RSI_PANE * 100 + 3}%`, width: 40, alignItems: 'center', gap: 2 }}>
              <Text variant="small" style={{ fontSize: theme.type.t2xs, lineHeight: theme.type.t2xs * 1.3 }}>70</Text>
              <View style={{ flex: 1, width: 14, borderRadius: theme.radius.rSm, overflow: 'hidden', ...glass }}>
                <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '30%', backgroundColor: theme.color.line }} />
                <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '30%', backgroundColor: theme.color.line }} />
                {signal?.value !== undefined ? (
                  <View style={{ position: 'absolute', left: 0, right: 0, bottom: `${Math.max(0, Math.min(100, signal.value))}%`, height: 4, backgroundColor: theme.color.accent }} />
                ) : null}
              </View>
              <Text variant="small" style={{ fontSize: theme.type.t2xs, lineHeight: theme.type.t2xs * 1.3 }}>30</Text>
              <Text variant="num" testID="rsi-value" style={{ fontSize: theme.type.tSm, lineHeight: theme.type.tSm * 1.2, fontFamily: face(theme, 'num', 700) }}>
                {signal?.value !== undefined ? String(signal.value) : '—'}
              </Text>
            </View>
            <View
              pointerEvents="none"
              testID="chart-legend"
              style={{ position: 'absolute', top: `${(1 - RSI_PANE) * 100}%`, marginTop: 6, left: 10, paddingVertical: 3, paddingHorizontal: 8, borderRadius: theme.radius.rSm, ...glass, ...(lit ? { borderColor: theme.color.accent } : null) }}
            >
              <Text variant="small" style={{ fontSize: theme.type.tXs, lineHeight: theme.type.tXs * 1.3, fontFamily: face(theme, 'display', 600), letterSpacing: 0.4 }}>
                {`RSI 14 · ${INTERVAL_LABELS[interval]}${lit && signal?.lastAt ? ` · zone ${hm(signal.lastAt)}${left ? ` · ${left} left` : ''}` : ''}`}
              </Text>
            </View>
          </>
        ) : null}

        {/* Bottom-left, MA Cross only: which lines these are, and what they say —
            the trend, or the cross and how long its window has left. */}
        {averages && !picking ? (
          <View
            pointerEvents="none"
            testID="chart-legend"
            style={{ position: 'absolute', bottom: 36, left: 10, paddingVertical: 3, paddingHorizontal: 8, borderRadius: theme.radius.rSm, ...glass, ...(lit ? { borderColor: theme.color.accent } : null) }}
          >
            <Text variant="small" style={{ fontSize: theme.type.tXs, lineHeight: theme.type.tXs * 1.3 }}>
              {`MA ${averages.fast} · MA ${averages.slow} · ${INTERVAL_LABELS[interval]} · ${
                lit && averages.lastCross ? `cross ${hm(averages.lastCross.at)}${left ? ` · ${left} left` : ''}` : `trend ${averages.trend}`
              }`}
            </Text>
          </View>
        ) : null}
      </View>

      {/* The two steps of the walk, out at the screen's own edges. A key
          over the bars would hide what it moves, so they stand beside. */}
      {charts.of > 1 ? (
        <>
          <Step where="left" onPress={() => step(-1)} />
          <Step where="right" onPress={() => step(1)} />
        </>
      ) : null}
    </View>
  );
}

/**
 * One step along the chart walk, as a key at the screen's edge.
 *
 * Out in the margin the screen keeps for itself: it overlaps the pane by a
 * few points, enough to read as belonging to it, and leaves the bars alone.
 * The hit area is wider than the key, so the thumb finds it anyway.
 */
const STEP_KEY = 38;

function Step({ where, onPress }: { where: 'left' | 'right'; onPress: () => void }) {
  const theme = useTheme();
  const left = where === 'left';
  return (
    <Pressable
      testID={left ? 'chart-prev' : 'chart-next'}
      accessibilityRole="button"
      accessibilityLabel={left ? 'The chart before this one' : 'The next chart'}
      hitSlop={16}
      onPress={onPress}
      style={({ pressed }) => ({
        position: 'absolute',
        top: '50%',
        marginTop: -STEP_KEY / 2,
        // Two thirds of the way out into the screen's own side margin.
        ...(left ? { left: -20 } : { right: -20 }),
        width: STEP_KEY,
        height: STEP_KEY,
        borderRadius: STEP_KEY / 2,
        alignItems: 'center',
        justifyContent: 'center',
        // Opaque, not glass: the key sits over candles of any colour, and a
        // translucent one disappears into a dense pane exactly when the
        // chart is worth stepping through.
        backgroundColor: pressed ? theme.color.accent : theme.color.paper,
        borderWidth: theme.size.bw,
        borderColor: pressed ? theme.color.accent : theme.color.line,
        ...(theme.shadow.card ? { boxShadow: theme.shadow.card } : null),
        transform: [{ scale: pressed ? 0.92 : 1 }],
      })}
    >
      {({ pressed }: { pressed: boolean }) => (
        // Drawn rather than typed: a chevron glyph carries the font's own
        // side bearings, so it never sits in the middle of a round key.
        <Svg width={STEP_KEY} height={STEP_KEY} viewBox="0 0 24 24">
          <Path
            d={left ? 'M14.5 6.5 9.5 12l5 5.5' : 'M9.5 6.5 14.5 12l-5 5.5'}
            fill="none"
            stroke={pressed ? theme.color.onAccent : theme.color.ink}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      )}
    </Pressable>
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
function Says({ id, symbol, signal }: { id: StrategyId; symbol: string; signal: ReturnType<typeof useSignal> }) {
  const theme = useTheme();
  const { settings } = usePositionSettings();
  const left = useCountdown(signal?.expiresAt ?? null);

  if (id === 'direction') {
    return (
      <Text variant="bodyStrong" style={{ textAlign: 'center', fontSize: theme.type.tMd, fontFamily: face(theme, 'display', 700) }} testID="says">
        {`Where does ${symbol} go in the next ${settings.horizonMinutes} minutes?`}
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
function OpenPosition({
  position,
  busy,
  onClose,
  onReverse,
  onAmend,
  strategy,
  onSignal,
}: {
  position: Position;
  busy: Busy;
  onClose: () => void;
  onReverse: () => void;
  onAmend: (change: ExitsChange) => Promise<boolean>;
  strategy: string;
  onSignal?: boolean;
}) {
  const theme = useTheme();
  const left = useCountdown(position.closes_at ?? null);
  const [exits, setExits] = useState(false);
  const pnl = Number(position.unrealized_pnl);
  const colour = pnl > 0.005 ? theme.color.up : pnl < -0.005 ? theme.color.down : theme.color.ink;
  const run = elapsedShare(position);
  const [shared, setShared] = useState<string | null>(null);
  const share = async () => {
    const out = await shareTrade(
      {
        kind: 'live',
        strategy,
        symbol: position.symbol,
        side: position.side,
        notional: Number(position.notional),
        leverage: String(Number(position.leverage)),
        pnl,
        closesIn: left,
      },
      theme,
    );
    setShared(out === 'copied' ? 'Copied' : out === 'shared' ? 'Shared' : null);
    setTimeout(() => setShared(null), 2000);
  };

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
          // Taken on the signal: the card wears the accent, as the lit
          // chart did, so the screen says "you caught it" without a word.
          backgroundColor: onSignal ? theme.color.accent + '1F' : theme.color.soft,
          borderWidth: onSignal ? 2 : 0,
          borderColor: onSignal ? theme.color.accent : 'transparent',
        }}
      >
        <View style={{ gap: theme.space.s1, flex: 1 }}>
          {onSignal ? (
            <Text variant="caps" testID="on-signal" style={{ color: theme.color.accent }}>On the signal</Text>
          ) : null}
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
            style={{ fontSize: theme.type.tHero, fontFamily: face(theme, 'num', 700), color: colour }}
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
            <Text variant="num" style={{ fontSize: theme.type.t2xl, lineHeight: lineBox('num', theme.type.t2xl), fontFamily: face(theme, 'num', 700) }}>{left}</Text>
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

      {/* The two ways out of the trade side by side, and everything that can
          still be changed about it one line further down, behind a sheet:
          the screen stays one number and its buttons. */}
      <View style={{ flexDirection: 'row', gap: theme.space.s3 }}>
        <Button testID="close-position" title="Close now" variant="outline" small busy={busy === 'close'} disabled={busy !== null} onPress={onClose} style={{ flex: 1 }} />
        <Button testID="reverse-position" title="Reverse" variant="outline" small busy={busy === 'reverse'} disabled={busy !== null} onPress={onReverse} style={{ flex: 1 }} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: theme.space.s4 }}>
        <Text variant="body" testID="position-exits" style={{ paddingVertical: theme.space.s1 }} onPress={() => setExits(true)}>
          Stop · target · time ›
        </Text>
        <Text variant="body" testID="share-position" style={{ paddingVertical: theme.space.s1 }} onPress={() => void share()}>
          {shared ?? 'Share'}
        </Text>
      </View>

      <ExitsSheet open={exits} position={position} busy={busy === 'amend'} onApply={onAmend} onClose={() => setExits(false)} />
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
const CARD_ROWS = 5;

function HistoryCard({ id, trades }: { id: StrategyId; trades: Trade[] }) {
  const theme = useTheme();
  const [tab, setTab] = useState<'positions' | 'orders'>('positions');
  const [page, setPage] = useState(1);
  // Five rows of whichever tab, and the way to the next five. The orders
  // tab has two rows per closed round trip, so it is cut after flattening.
  const positions = trades;
  const orders = trades.flatMap((t) => orderRows(t));
  const pages = Math.max(1, Math.ceil((tab === 'positions' ? positions.length : orders.length) / CARD_ROWS));
  const at = Math.min(page, pages);
  const rows = slice(positions, at, CARD_ROWS);
  const orderPage = slice(orders, at, CARD_ROWS);
  const pick = (next: typeof tab) => {
    setTab(next);
    setPage(1);
  };

  return (
    <Card testID="history" style={{ gap: theme.space.s2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.s2 }}>
        <Chip label="Positions" on={tab === 'positions'} onPress={() => pick('positions')} testID="history-positions" />
        <Chip label="Orders" on={tab === 'orders'} onPress={() => pick('orders')} testID="history-orders" />
        <Pressable testID="history-all" accessibilityRole="link" onPress={() => router.push('/history')} style={{ marginLeft: 'auto', paddingVertical: theme.space.s1 }}>
          <Text variant="small">All history ›</Text>
        </Pressable>
      </View>
      {trades.length === 0 ? (
        <Text variant="small" style={{ paddingVertical: 8 }}>{`No trades yet in ${STRATEGY_NAMES[id] ?? 'Direction'}.`}</Text>
      ) : tab === 'positions' ? (
        rows.map((t) => <TradeRow key={t.opened_at} trade={t} strategy={id} />)
      ) : (
        orderPage.map((o) => <OrderRow key={o.key} title={o.title} sub={o.sub} to={o.to} />)
      )}
      {pages > 1 ? (
        <View style={{ paddingTop: theme.space.s2 }}>
          <Pager page={at} pages={pages} hasNext={at < pages} onPrev={() => setPage(at - 1)} onNext={() => setPage(at + 1)} testID="card-pager" />
        </View>
      ) : null}
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
