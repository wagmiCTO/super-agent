/**
 * Risk & performance: the wallet across every strategy in one place.
 *
 * What can be lost right now (open positions, their stops, their distance
 * to liquidation), how much of each limit is spent (today's loss budget,
 * exposure, cooldown), how the round trips went today, this week and ever,
 * and what the market itself costs against what it moves. One button
 * closes everything; it asks twice.
 */
import { Link } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAccount } from '@/account/useAccount';
import { api, ApiError, describeError, type RiskReport } from '@/api/client';
import { AccountSection } from '@/components/account';
import { trim } from '@/components/format';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { NoticeBox, ScreenHeader, styles, useCountdown } from '@/components/trading';
import { STATE_POLL_MS, STRATEGY_NAMES } from '@/config';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Notice } from '@/trading/useTrading';

const UP = '#16a34a';
const DOWN = '#dc2626';

type Perf = NonNullable<RiskReport['totals']['today']>;
type RiskPosition = RiskReport['open'][number];
type RiskStrategy = RiskReport['strategies'][number];

export default function RiskScreen() {
  const account = useAccount();
  const theme = useTheme();
  const [report, setReport] = useState<RiskReport | null>(null);
  const [locked, setLocked] = useState(false);
  const [offline, setOffline] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await api.risk();
      setReport(r);
      setLocked(false);
      setOffline(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'network') setOffline(true);
      if (e instanceof ApiError && (e.code === 'own_account_disabled' || e.code === 'no_key')) {
        setLocked(true);
        setReport(null);
      }
    }
  }, []);
  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, STATE_POLL_MS);
    return () => clearInterval(id);
  }, [refresh, account.state.status]);

  const closeAll = async () => {
    if (!confirm) {
      setConfirm(true);
      setTimeout(() => setConfirm(false), 5000);
      return;
    }
    setConfirm(false);
    setBusy(true);
    setNotice(null);
    try {
      const res = await api.closeAll();
      const failed = res.results.filter((r) => !r.closed);
      setNotice({
        text: failed.length ? `Closed ${res.closed}, ${failed.length} failed: ${failed.map((f) => f.error).join('; ')}` : `Closed ${res.closed} position${res.closed === 1 ? '' : 's'}`,
        kind: failed.length ? 'error' : 'info',
      });
      await refresh();
    } catch (e) {
      setNotice({ text: describeError(e), kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const open = report?.open ?? [];
  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <ScreenHeader title="RISK & PERFORMANCE" state={null} offline={offline} locked={locked} />
          <AccountSection account={account} state={null} onChange={refresh} />

          {report ? (
            <>
              <View style={[styles.card, { backgroundColor: theme.backgroundElement, alignItems: 'stretch', gap: Spacing.one }]} testID="risk-totals">
                <View style={styles.header}>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    AT RISK NOW
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    exposure {trim(report.totals.exposure)}
                  </ThemedText>
                </View>
                <ThemedText type="title" testID="risk-at-risk">
                  {trim(report.totals.at_risk)}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  what every open position can still lose · today&apos;s loss so far {trim(report.totals.daily_loss)}
                </ThemedText>
                <PerfRow label="Today" p={report.totals.today} />
                <PerfRow label="This week" p={report.totals.week} />
                <PerfRow label="All time" p={report.totals.all} />
              </View>

              <View style={[styles.card, { backgroundColor: theme.backgroundElement, alignItems: 'stretch', gap: Spacing.one }]} testID="risk-open">
                <ThemedText type="smallBold" themeColor="textSecondary">
                  OPEN · {open.length}
                </ThemedText>
                {open.length === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Nothing open. Nothing at risk.
                  </ThemedText>
                ) : (
                  open.map((p) => <OpenRow key={`${p.strategy}-${p.id}`} p={p} />)
                )}
                {open.length > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={confirm ? 'Confirm close everything' : 'Close everything'}
                    onPress={() => void closeAll()}
                    disabled={busy}
                    style={({ pressed }) => [styles.closeButton, { opacity: pressed || busy ? 0.6 : 1 }]}
                    testID="close-all">
                    <ThemedText style={styles.buttonLabel}>{confirm ? 'Tap again to close everything' : 'Close everything'}</ThemedText>
                  </Pressable>
                ) : null}
                <NoticeBox notice={notice} />
              </View>

              {report.strategies.map((s) => (
                <StrategyRisk key={s.id} s={s} />
              ))}

              {report.market.map((m) => (
                <View key={m.symbol} style={[styles.card, { backgroundColor: theme.backgroundElement, alignItems: 'stretch', gap: 4 }]} testID="risk-market">
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    MARKET · {m.symbol}
                  </ThemedText>
                  <ThemedText type="small">
                    A minute moves {m.vol_1m_bps.toFixed(1)} bps; a round trip costs {m.round_trip_bps.toFixed(1)} bps. Edge {m.edge.toFixed(1)}×.
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {m.edge >= 5
                      ? 'The strategies were sized for 5× and above: fees are a small share of a typical move.'
                      : m.edge >= 2
                        ? 'Below the 5× the strategies were sized for: fees eat a bigger share of each move. Fewer, larger entries.'
                        : 'Fees are most of a typical minute. A quiet market; an entry needs a bigger move than usual to pay.'}
                    {m.bars < 30 ? ` · ${m.bars} bars` : ''}
                  </ThemedText>
                </View>
              ))}
              <ThemedText type="small" themeColor="textSecondary" style={styles.footer}>
                Limits are enforced by the platform before any order reaches the exchange; stops are judged on the exchange&apos;s own mark.
              </ThemedText>
            </>
          ) : (
            <ThemedText type="small" themeColor="textSecondary" style={styles.footer}>
              {locked ? 'Sign in with your passkey and enable a strategy to see your risk.' : offline ? 'Server unreachable' : 'Loading…'}
            </ThemedText>
          )}

          <Link href="/" style={styles.link} accessibilityRole="link">
            <ThemedText type="smallBold" themeColor="textSecondary">
              ← Lobby
            </ThemedText>
          </Link>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function PerfRow({ label, p }: { label: string; p?: Perf }) {
  const theme = useTheme();
  if (!p) return null;
  const pnl = Number(p.pnl);
  const color = pnl > 0 ? UP : pnl < 0 ? DOWN : theme.text;
  return (
    <View style={styles.header} testID={`perf-${label.toLowerCase().replace(/\s/g, '-')}`}>
      <ThemedText type="small" themeColor="textSecondary">
        {label} · {p.trades} trade{p.trades === 1 ? '' : 's'}
        {p.trades ? ` · ${Math.round(p.win_rate * 100)}% won · fees ${trim(p.fees)}` : ''}
      </ThemedText>
      <ThemedText type="smallBold" style={{ color }}>
        {pnl > 0 ? '+' : ''}
        {trim(p.pnl)}
      </ThemedText>
    </View>
  );
}

function OpenRow({ p }: { p: RiskPosition }) {
  const theme = useTheme();
  const closesIn = useCountdown(p.closes_at ?? null);
  const pnl = Number(p.unrealized_pnl);
  const color = pnl > 0 ? UP : pnl < 0 ? DOWN : theme.text;
  return (
    <View style={{ gap: 2 }} testID="risk-position">
      <View style={styles.header}>
        <ThemedText type="small">
          {STRATEGY_NAMES[p.strategy] ?? p.strategy} · {p.side === 'long' ? 'Up' : 'Down'} {trim(p.size)} {p.symbol} @ {trim(p.entry_price)} · {p.leverage}x
        </ThemedText>
        <ThemedText type="smallBold" style={{ color }}>
          {pnl > 0 ? '+' : ''}
          {trim(p.unrealized_pnl)}
        </ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        at risk {trim(p.at_risk)}
        {p.stop_pnl ? ` · stop at ${trim(p.stop_pnl)}` : ' · no stop'}
        {closesIn ? ` · closes in ${closesIn}` : ''}
        {p.distance_to_liquidation_pct ? ` · liquidation ${trim(p.distance_to_liquidation_pct)}% away` : ''}
      </ThemedText>
    </View>
  );
}

function StrategyRisk({ s }: { s: RiskStrategy }) {
  const theme = useTheme();
  const cooldown = s.usage?.cooldown_left_seconds ?? 0;
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement, alignItems: 'stretch', gap: 6 }]} testID={`risk-${s.id}`}>
      <View style={styles.header}>
        <ThemedText type="smallBold">{s.name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {!s.enabled ? 'not enabled' : s.killed ? 'paused by the platform' : `${s.open.length} open`}
        </ThemedText>
      </View>
      {s.enabled && s.usage && s.limits ? (
        <>
          <Bar label="Today's loss budget" used={Number(s.usage.daily_loss)} max={Number(s.limits.daily_loss)} pctLabel={`${trim(s.usage.daily_loss_left)} left of ${s.limits.daily_loss}`} />
          <Bar label="Exposure" used={Number(s.usage.exposure)} max={Number(s.limits.max_total_exposure)} pctLabel={`${trim(s.usage.exposure)} of ${s.limits.max_total_exposure} · up to ${s.limits.max_notional} per position · ${s.limits.max_leverage}x`} />
          {cooldown > 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Cooldown: next entry in {Math.ceil(cooldown)}s
            </ThemedText>
          ) : null}
          <PerfRow label="Today" p={s.today} />
          <PerfRow label="This week" p={s.week} />
          <PerfRow label="All time" p={s.all} />
          {s.all && s.all.trades > 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              best {trim(s.all.best)} · worst {trim(s.all.worst)} · max drawdown {trim(s.all.max_drawdown)}
              {s.all.streak ? ` · ${Math.abs(s.all.streak)} ${s.all.streak > 0 ? 'wins' : 'losses'} in a row` : ''}
              {' · closed by '}
              {Object.entries(s.all.by_reason)
                .map(([k, v]) => `${k} ${v}`)
                .join(', ') || 'nobody yet'}
            </ThemedText>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function Bar({ label, used, max, pctLabel }: { label: string; used: number; max: number; pctLabel: string }) {
  const theme = useTheme();
  const frac = max > 0 ? Math.max(0, Math.min(1, used / max)) : 0;
  const color = frac >= 0.8 ? DOWN : frac >= 0.5 ? '#d97706' : UP;
  return (
    <View style={{ gap: 2 }}>
      <View style={styles.header}>
        <ThemedText type="small" themeColor="textSecondary">
          {label}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {pctLabel}
        </ThemedText>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.backgroundSelected, overflow: 'hidden' }}>
        <View style={{ width: `${Math.round(frac * 100)}%`, height: 6, backgroundColor: color }} />
      </View>
    </View>
  );
}
