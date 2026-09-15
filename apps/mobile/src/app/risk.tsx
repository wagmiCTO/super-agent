/**
 * Risk — the day, as the design draws it.
 *
 * One arc for how much of today's budget is spoken for, the budget itself
 * as a bar of lost / at stake / left, a ring per strategy, what is open
 * right now, the limits, the week, the day hour by hour, and the one red
 * button. Everything comes from one report the platform assembles; the
 * hour bars are built here from today's round trips.
 *
 * Below the limits sits the danger zone: the limits are the wallet's to
 * raise, between the safe tier everyone starts on and the ceiling the
 * platform holds. A choice takes a second tap, like closing everything.
 */

import { router, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { api, ApiError, describeError, type LimitTier, type RiskReport, type Trade } from '@/api/client';
import { trim } from '@/components/format';
import { DEFAULT_SYMBOL, STATE_POLL_MS, STRATEGY_NAMES } from '@/config';
import { RiskGauge, StrategyRing } from '@/risk/gauge';
import { hoursInPlay } from '@/risk/hours';
import { riskLevel } from '@/strategy/risk';
import { usePositionSettings } from '@/trading/useSettings';
import { Bone, BoneCard, FadeIn, useGrow } from '@/ui/anim';
import { Button } from '@/ui/button';
import { useCountdown } from '@/ui/countdown';
import { Slider } from '@/ui/slider';
import { StubHeader } from '@/ui/stub';
import { Card, Row, Screen } from '@/ui/surface';
import { Text, money } from '@/ui/text';
import { useTheme } from '@/theme';

type OpenNow = RiskReport['open'][number];

const ROUTES: Record<string, Href> = { direction: '/direction', 'ma-cross': '/ma-cross', rsi: '/rsi' };
const STRATEGIES = ['direction', 'ma-cross', 'rsi'] as const;

/** The report, polled; null until the first answer. */
function useRisk() {
  const [report, setReport] = useState<RiskReport | null>(null);
  const [problem, setProblem] = useState<'locked' | 'offline' | null>(null);
  const refresh = useCallback(async () => {
    try {
      setReport(await api.risk());
      setProblem(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'network') setProblem('offline');
      else if (e instanceof ApiError && (e.code === 'own_account_disabled' || e.code === 'no_key')) setProblem('locked');
    }
  }, []);
  useEffect(() => {
    // Deferred rather than called in the effect body: the first read is a
    // poll like every other, not a render-time state change.
    const first = setTimeout(refresh, 0);
    const id = setInterval(refresh, STATE_POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh]);
  return { report, problem, refresh };
}

/** Today's round trips across the strategies, for the hour bars. */
function useTodayTrades(): Trade[] {
  const [trades, setTrades] = useState<Trade[]>([]);
  useEffect(() => {
    let alive = true;
    const read = () =>
      Promise.all(STRATEGIES.map((s) => api.trades(DEFAULT_SYMBOL, s).catch(() => [] as Trade[]))).then((lists) => {
        if (!alive) return;
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        setTrades(lists.flat().filter((t) => t.closed_at && new Date(t.closed_at) >= start));
      });
    void read();
    const id = setInterval(read, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return trades;
}

export default function RiskScreen() {
  const theme = useTheme();
  const { report, problem, refresh } = useRisk();
  const trades = useTodayTrades();
  const { settings } = usePositionSettings();
  // Something in the way is worth a sentence; simply waiting is not. A word
  // like "Loading…" on an empty screen is the app admitting it has nothing,
  // so instead the screen draws itself — the panel, empty, with the needles
  // sweeping — and the reading arrives into a dashboard that is already there.
  const stalled = report === null && problem !== null;

  return (
    <Screen testID="risk">
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 52, paddingBottom: theme.space.s6, gap: theme.space.s4 }}>
        <StubHeader title="Risk" badge={problem === 'offline' ? 'OFFLINE' : problem === 'locked' ? 'SIGN IN' : 'TESTNET'} />
        {stalled ? (
          <Text variant="small">
            {problem === 'locked' ? 'Sign in with your passkey and open an account to see your risk.' : 'Server unreachable'}
          </Text>
        ) : (
          <>
            {/* Outside the branch below on purpose: the gauge is the same
                instrument before and after the answer, so it keeps its place
                in the tree and its needle hands the sweep over to the
                reading instead of restarting at zero. */}
            <Dial report={report} />
            {report ? (
              <FadeIn style={{ gap: theme.space.s4 }}>
                <Body report={report} trades={trades} leverage={settings.leverage} refresh={refresh} />
              </FadeIn>
            ) : (
              <Panel />
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

/** The day's share of the budget: the arc, the word, the sentence. */
function Dial({ report }: { report: RiskReport | null }) {
  const theme = useTheme();
  const reading = report ? dayReading(report) : null;

  return (
    <>
      {/* The prototype's box: a little taller than the drawing, with the two
          words at the screen's edges rather than on the arc's ends. */}
      <View style={{ height: 138, alignItems: 'center', justifyContent: 'flex-end' }} testID="risk-gauge">
        <RiskGauge percent={reading?.percent ?? null} />
        <Text variant="small" style={{ position: 'absolute', bottom: 0, left: 0, fontSize: theme.type.t2xs }}>calm</Text>
        <Text variant="small" style={{ position: 'absolute', bottom: 0, right: 0, fontSize: theme.type.t2xs }}>hot</Text>
      </View>
      {reading ? (
        <FadeIn style={{ alignItems: 'center', gap: 2 }}>
          <Text variant="h1" testID="risk-level">{riskLevel(reading.percent)}</Text>
          <Text variant="body" style={{ fontSize: theme.type.tSm, color: theme.color.body, textAlign: 'center' }} testID="risk-sub">{reading.sub}</Text>
        </FadeIn>
      ) : (
        <View style={{ alignItems: 'center', gap: theme.space.s2, paddingVertical: theme.space.s1 }}>
          <Bone width={130} height={22} radius={6} />
          <Bone width={230} height={10} />
        </View>
      )}
    </>
  );
}

/** How hot the day is, and the one line that says why. */
function dayReading(report: RiskReport) {
  const budget = Number(report.limits.active?.daily_loss ?? 0);
  const lost = Number(report.totals.daily_loss);
  const atStake = Number(report.totals.at_risk);
  const percent = budget > 0 ? Math.min(100, Math.round(((atStake + lost) / budget) * 100)) : 0;
  const open = report.open.length;
  const sub =
    percent === 0
      ? "Nothing open. The whole day's budget is still yours."
      : `${open} ${open === 1 ? 'trade' : 'trades'} open · ${atStake.toFixed(2)} AUSD can still be lost right now.`;
  return { percent, sub };
}

/** The screen before it has anything to say: its own shape, breathing. */
function Panel() {
  const theme = useTheme();
  return (
    <>
      <View style={{ gap: theme.space.s2 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Bone width={140} height={10} />
          <Bone width={70} height={10} />
        </View>
        <Bone width="100%" height={10} radius={999} />
        <Bone width="82%" height={8} />
      </View>
      <View style={{ flexDirection: 'row', gap: theme.space.s2 }}>
        {STRATEGIES.map((id, i) => (
          <View
            key={id}
            style={{
              flex: 1,
              alignItems: 'center',
              gap: theme.space.s2,
              paddingVertical: theme.space.s3,
              paddingHorizontal: theme.space.s2,
              borderRadius: theme.radius.rLg,
              backgroundColor: theme.color.cardBg,
              borderWidth: theme.color.cardLine === 'transparent' ? 0 : theme.size.bw,
              borderColor: theme.color.cardLine,
            }}
          >
            <StrategyRing percent={null} delay={i * 220} />
            <Bone width={54} height={9} />
            <Bone width={40} height={8} />
          </View>
        ))}
      </View>
      <BoneCard lines={3} />
      <BoneCard lines={5} />
    </>
  );
}

function Body({ report, trades, leverage, refresh }: { report: RiskReport; trades: Trade[]; leverage: number; refresh: () => Promise<void> }) {
  const theme = useTheme();
  const budget = Number(report.limits.active?.daily_loss ?? 0);
  const lost = Number(report.totals.daily_loss);
  const atStake = Number(report.totals.at_risk);
  const left = Math.max(0, budget - lost);
  const open = report.open;
  const week = report.totals.week;
  const hours = useMemo(() => hoursInPlay(trades, open, new Date()), [trades, open]);
  const hour = new Date().getHours();

  return (
    <>
      {/* Today's loss budget: lost, at stake, left. */}
      <View style={{ gap: theme.space.s2 }} testID="risk-budget">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="caps">Today&apos;s loss budget</Text>
          <Text variant="num">{`${lost.toFixed(2)} of ${budget.toFixed(0)}`}</Text>
        </View>
        <BudgetBar
          lost={budget > 0 ? Math.min(100, (lost / budget) * 100) : 0}
          stake={budget > 0 ? Math.min(100, (Math.min(atStake, left) / budget) * 100) : 0}
        />
        <Text variant="small" style={{ fontSize: theme.type.t2xs }}>
          {`${lost.toFixed(2)} lost · ${Math.min(atStake, left).toFixed(2)} at stake now · ${left.toFixed(2)} left. At ${budget.toFixed(0)} the day closes itself.`}
        </Text>
      </View>

      {/* One ring per strategy. */}
      <View style={{ flexDirection: 'row', gap: theme.space.s2 }}>
        {report.strategies.map((s, i) => {
          const stake = s.open.reduce((sum, p) => sum + Number(p.at_risk), 0);
          const first = s.open[0];
          return (
            <View
              key={s.id}
              testID={`ring-${s.id}`}
              style={{
                flex: 1,
                alignItems: 'center',
                gap: theme.space.s2,
                paddingVertical: theme.space.s3,
                paddingHorizontal: theme.space.s2,
                borderRadius: theme.radius.rLg,
                backgroundColor: theme.color.cardBg,
                borderWidth: theme.color.cardLine === 'transparent' ? 0 : theme.size.bw,
                borderColor: theme.color.cardLine,
              }}
            >
              <StrategyRing percent={budget > 0 ? Math.min(100, Math.round((stake / budget) * 100)) : 0} delay={i * 220} />
              <Text variant="bodyStrong" style={{ fontSize: theme.type.tXs }}>{s.name.replace(' Bounce', '')}</Text>
              <Text variant="small" style={{ fontSize: theme.type.t2xs, textAlign: 'center' }}>
                {first ? `${Number(first.collateral).toFixed(2)} × ${trim(first.leverage)}x` : 'quiet'}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Open now. */}
      <Card style={{ gap: theme.space.s2 }} testID="risk-open">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="caps">Open now</Text>
          <Text variant="num">{`${atStake.toFixed(2)} AUSD at stake`}</Text>
        </View>
        {open.length === 0 ? (
          <Text variant="small" style={{ paddingVertical: theme.space.s2 }}>Nothing open. Every tap you make shows up here while it runs.</Text>
        ) : (
          open.map((p) => <OpenRow key={`${p.strategy}-${p.id}`} p={p} />)
        )}
      </Card>

      {/* Limits. */}
      <Card style={{ gap: theme.space.s1 }} testID="risk-limits">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.space.s1 }}>
          <Text variant="caps">Limits</Text>
          <Text variant="small">yours to change below</Text>
        </View>
        <Row label="Per position" value={`up to ${trim(report.limits.active?.max_leverage ?? '1')}x · your whole balance`} />
        <Row label="Daily loss" value={`${budget.toFixed(0)} AUSD · ${report.limits.chosen.daily_loss_pct}% of balance`} />
        <Row label="Open at once" value={`${report.limits.chosen.max_open_positions} ${report.limits.chosen.max_open_positions === 1 ? 'position' : 'positions'}`} />
        <Row label="Cooldown between taps" value={`${report.limits.chosen.cooldown_seconds} s`} />
        <Row label="Liquidation" value={`${(100 / Math.max(1, leverage)).toFixed(1)}% against you`} />
      </Card>

      <DangerZone limits={report.limits} refresh={refresh} />

      {/* This week. */}
      {week ? (
        <Card style={{ gap: theme.space.s1 }} testID="risk-week">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.space.s1 }}>
            <Text variant="caps">This week</Text>
            <Text variant="small">{`${week.trades} ${week.trades === 1 ? 'trade' : 'trades'}`}</Text>
          </View>
          <Row label="Result" value={`${money(Number(week.pnl))} AUSD`} tone={Number(week.pnl)} />
          <Row label="Won" value={`${week.wins} of ${week.trades}`} />
          <Row label="Worst single tap" value={money(Number(week.worst))} tone={Number(week.worst)} />
          <Row label="Stops that fired" value={String(week.by_reason.stop ?? 0)} />
          <Row label="Fees paid" value={Number(week.fees).toFixed(2)} />
        </Card>
      ) : null}

      {/* Today, hour by hour. */}
      <View testID="risk-hours">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="small">Today, hour by hour</Text>
          <Text variant="small">notional in play</Text>
        </View>
        <HourBars hours={hours} hour={hour} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {['00', '06', '12', '18', '24'].map((h) => (
            <Text key={h} variant="small" style={{ fontSize: theme.type.t2xs }}>{h}</Text>
          ))}
        </View>
      </View>

      <CloseEverything open={open.length} />
    </>
  );
}

/**
 * The day's budget, filling: what is already lost, then what is still at
 * stake on top of it. Both grow in rather than appear, so the bar is read as
 * a level rather than as a picture.
 */
function BudgetBar({ lost, stake }: { lost: number; stake: number }) {
  const theme = useTheme();
  const l = useGrow(lost, { settle: 700 });
  const s = useGrow(stake, { settle: 900 });
  return (
    <View style={{ height: 10, borderRadius: 999, backgroundColor: theme.color.hair, overflow: 'hidden', flexDirection: 'row' }}>
      <View style={{ width: `${l}%`, backgroundColor: theme.color.down }} />
      <View style={{ width: `${s}%`, backgroundColor: theme.color.accent, opacity: 0.45 }} />
    </View>
  );
}

/** Today hour by hour, rising left to right as the eye crosses it. */
function HourBars({ hours, hour }: { hours: number[]; hour: number }) {
  const theme = useTheme();
  // One frame loop for the row: twenty-four springs would cost twenty-four
  // re-renders a frame, and this is a decoration, not an instrument.
  const grown = useGrow(100, { settle: 1000 });
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 40, marginTop: theme.space.s2 }}>
      {hours.map((v, i) => {
        const rise = Math.max(0, Math.min(1, (grown - i * 2) / 45));
        return (
          <View
            key={i}
            style={{
              flex: 1,
              height: `${Math.max(3, v * rise)}%`,
              borderRadius: 2,
              backgroundColor: i === hour ? theme.color.accent : v ? theme.color.dim : theme.color.hair,
            }}
          />
        );
      })}
    </View>
  );
}

/** One open position: the strategy and side, what it is, what it is at. */
function OpenRow({ p }: { p: OpenNow }) {
  const theme = useTheme();
  const closesIn = useCountdown(p.closes_at ?? null);
  const pnl = Number(p.unrealized_pnl);
  const stop = p.stop_pnl !== undefined ? `stop ${money(Number(p.stop_pnl), 0)}` : 'no stop';
  return (
    <Pressable
      testID="risk-position"
      accessibilityRole="button"
      accessibilityLabel={`Open ${STRATEGY_NAMES[p.strategy] ?? p.strategy}`}
      onPress={() => router.push(ROUTES[p.strategy] ?? '/')}
      style={({ pressed }) => ({
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: theme.space.s2,
        borderTopWidth: theme.size.bw,
        borderTopColor: theme.color.hair,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ gap: 2, flexShrink: 1 }}>
        <Text variant="bodyStrong" style={{ fontSize: theme.type.tSm }}>{`${STRATEGY_NAMES[p.strategy] ?? p.strategy} · ${p.side === 'long' ? 'Up' : 'Down'}`}</Text>
        <Text variant="small" style={{ fontSize: theme.type.t2xs }}>
          {`${Number(p.collateral).toFixed(2)} × ${trim(p.leverage)}x · ${stop}${closesIn ? ` · closes in ${closesIn}` : ''}`}
        </Text>
      </View>
      <Text variant="num" signOf={pnl} style={{ fontSize: theme.type.tMd }}>{money(pnl)}</Text>
    </Pressable>
  );
}

/**
 * The danger zone: the three numbers the wallet may move, each between the
 * safe tier and the ceiling. Anything past the safe tier is drawn in the
 * colour of a loss. A change takes a second tap, and the platform answers
 * with what it now holds the wallet to.
 */
function DangerZone({ limits, refresh }: { limits: RiskReport['limits']; refresh: () => Promise<void> }) {
  const theme = useTheme();
  const { chosen, safe, ceiling } = limits;
  // What the sliders show: the platform's answer until the user moves one,
  // then the draft, until it is applied or the sliders go back to it.
  const [draft, setDraft] = useState<LimitTier | null>(null);
  const tier = draft ?? chosen;
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const dirty = tier.daily_loss_pct !== chosen.daily_loss_pct || tier.max_open_positions !== chosen.max_open_positions || tier.cooldown_seconds !== chosen.cooldown_seconds;
  const danger = (t: LimitTier) => t.daily_loss_pct > safe.daily_loss_pct || t.max_open_positions > safe.max_open_positions || t.cooldown_seconds < safe.cooldown_seconds;

  const set = (patch: Partial<LimitTier>) => {
    setConfirm(false);
    setDraft({ ...tier, ...patch });
  };

  const apply = async (next: LimitTier) => {
    if (!confirm && danger(next)) {
      setConfirm(true);
      setTimeout(() => setConfirm(false), 4000);
      return;
    }
    setConfirm(false);
    setBusy(true);
    setNotice(null);
    try {
      await api.setLimits(next);
      setDraft(null);
      await refresh();
      setNotice(danger(next) ? 'Applied. You are past the safe tier: the stop and the budget are what is left.' : 'Applied.');
    } catch (e) {
      setNotice(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const tone = (hot: boolean) => (hot ? theme.color.down : theme.color.ink);

  return (
    <Card style={{ gap: theme.space.s3, borderWidth: theme.size.bw, borderColor: danger(tier) ? theme.color.down : theme.color.cardLine }} testID="danger-zone">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="caps" style={{ color: theme.color.down }}>Danger zone</Text>
        <Text variant="small">{`safe: ${safe.daily_loss_pct}% · ${safe.max_open_positions} open · ${safe.cooldown_seconds} s`}</Text>
      </View>

      <View style={{ gap: theme.space.s1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="small" style={{ color: theme.color.body }}>Daily loss budget</Text>
          <Text variant="num" style={{ color: tone(tier.daily_loss_pct > safe.daily_loss_pct) }} testID="danger-daily">{`${tier.daily_loss_pct}% of balance`}</Text>
        </View>
        <Slider value={tier.daily_loss_pct} min={1} max={ceiling.daily_loss_pct} step={1} onChange={(v) => set({ daily_loss_pct: v })} testID="danger-daily-slider" />
      </View>

      <View style={{ gap: theme.space.s1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="small" style={{ color: theme.color.body }}>Open at once</Text>
          <Text variant="num" style={{ color: tone(tier.max_open_positions > safe.max_open_positions) }} testID="danger-positions">{`${tier.max_open_positions}`}</Text>
        </View>
        <Slider value={tier.max_open_positions} min={1} max={ceiling.max_open_positions} step={1} onChange={(v) => set({ max_open_positions: v })} testID="danger-positions-slider" />
      </View>

      <View style={{ gap: theme.space.s1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="small" style={{ color: theme.color.body }}>Cooldown between taps</Text>
          <Text variant="num" style={{ color: tone(tier.cooldown_seconds < safe.cooldown_seconds) }} testID="danger-cooldown">{`${tier.cooldown_seconds} s`}</Text>
        </View>
        <Slider value={tier.cooldown_seconds} min={ceiling.cooldown_seconds} max={60} step={1} onChange={(v) => set({ cooldown_seconds: v })} testID="danger-cooldown-slider" />
      </View>

      <View style={{ gap: theme.space.s2 }}>
        <Button
          testID="danger-apply"
          title={busy ? 'Applying…' : confirm ? 'Tap again to go past the safe tier' : 'Apply'}
          variant={confirm ? 'danger' : danger(tier) ? 'outline' : 'primary'}
          disabled={!dirty}
          busy={busy}
          onPress={() => void apply(tier)}
        />
        {danger(chosen) || danger(tier) ? (
          <Text variant="small" testID="danger-reset" onPress={() => void apply(safe)} style={{ textAlign: 'center', color: theme.color.accent }}>
            Back to safe defaults
          </Text>
        ) : null}
        {notice ? <Text variant="small" testID="danger-notice" style={{ textAlign: 'center' }}>{notice}</Text> : null}
      </View>
    </Card>
  );
}

/** The one red button: outline, then red with a countdown, then everything closes. */
function CloseEverything({ open }: { open: number }) {
  const theme = useTheme();
  const [confirm, setConfirm] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (confirm <= 0) return;
    const id = setTimeout(() => setConfirm((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [confirm]);

  const press = async () => {
    if (confirm === 0) {
      setConfirm(3);
      return;
    }
    setConfirm(0);
    setBusy(true);
    setError(null);
    try {
      const res = await api.closeAll();
      router.replace({ pathname: '/closed', params: { r: JSON.stringify(res) } });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ marginTop: theme.space.s3, gap: theme.space.s3 }}>
      {open === 0 ? (
        <Button testID="close-all" title="Nothing to close" disabled />
      ) : (
        <Button
          testID="close-all"
          title={confirm > 0 ? `Tap again to close everything · ${confirm}` : 'Close everything'}
          variant={confirm > 0 ? 'danger' : 'outline'}
          busy={busy}
          onPress={() => void press()}
        />
      )}
      <Text variant="small" style={{ textAlign: 'center' }}>{error ?? 'One tap closes every open trade at market.'}</Text>
    </View>
  );
}
