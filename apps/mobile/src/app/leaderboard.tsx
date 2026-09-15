/**
 * Leaderboard and prizes — one screen, as the design draws it.
 *
 * Four tabs (a strategy each, then all of them together), a This week / All
 * time switch, the board itself, and above it the prize to claim when the
 * chain has published one.
 *
 * The board is ranked by **result**, not by traded volume as the first
 * wireframe had it: the prize is settled on the top three by realized result
 * (ADR 0004), and a board that ranks by anything else would be a board that
 * does not decide the money it sits under.
 *
 * Every number here comes from somewhere: the standings and the pools from
 * `/v1/leaderboard`, your own line from `/v1/risk` (which knows your week and
 * your all-time per strategy even when you are nowhere near the top ten), the
 * prize you can take from `/v1/prizes` and the contract itself.
 */
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { useAccount } from '@/account/useAccount';
import { api, ApiError, describeError, type Board, type Leaderboard, type PrizeHistory, type RiskReport } from '@/api/client';
import { shortAddress, unclaimedTotal, useMyPrizes } from '@/components/prizes';
import { LEADERBOARD_POLL_MS, STRATEGY_NAMES } from '@/config';
import { claimPrize } from '@/exchange/prize';
import { useLeaderboard } from '@/trading/useLeaderboard';
import { Bone, FadeIn } from '@/ui/anim';
import { back } from '@/ui/stub';
import { Card, Chip, Screen } from '@/ui/surface';
import { Text, money } from '@/ui/text';
import { useTheme } from '@/theme';

type Period = 'week' | 'all';
type Tab = 'direction' | 'ma-cross' | 'rsi' | 'all';

const TABS: Tab[] = ['direction', 'ma-cross', 'rsi', 'all'];

/** How the pool is split among the top three — the contract's own shares. */
const SHARES = [0.5, 0.3, 0.2];

/** One line of the board. */
type Row = { wallet: string; pnl: number; trades: number; prize: number | null; you: boolean };

export default function LeaderboardScreen() {
  const theme = useTheme();
  const [period, setPeriod] = useState<Period>('week');
  const [tab, setTab] = useState<Tab>('direction');
  const lb = useLeaderboard(period);
  const account = useAccount();
  const unlocked = account.state.status === 'unlocked' ? account.state : null;
  const address = (unlocked?.stored.address ?? null)?.toLowerCase() ?? null;
  const mine = useMyStanding(address);
  const prizes = useMyPrizes(lb?.prize && address ? address : null);
  const claimable = unclaimedTotal(prizes.mine);

  const rows = lb ? rank(lb, tab, period, address, mine) : null;

  return (
    <Screen testID="leaderboard">
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 52, paddingBottom: theme.space.s6, gap: theme.space.s4 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.s3 }}>
          <Text variant="small" numberOfLines={1} testID="lobby-link" onPress={back}>‹ Lobby</Text>
          <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: theme.type.tMd, flexShrink: 1 }} testID="leaderboard-title">Leaderboard</Text>
          <View style={{ flex: 1 }} />
          <View style={{ flexDirection: 'row', gap: theme.space.s1 }}>
            <Chip label="This week" small on={period === 'week'} onPress={() => setPeriod('week')} testID="period-week" />
            <Chip label="All time" small on={period === 'all'} onPress={() => setPeriod('all')} testID="period-all" />
          </View>
        </View>

        {unlocked && lb?.prize && claimable ? (
          <ClaimBanner
            amount={claimable}
            contract={lb.prize.contract}
            wallet={unlocked.wallet}
            mine={prizes.mine}
            reload={prizes.reload}
          />
        ) : null}

        <View style={{ flexDirection: 'row', gap: theme.space.s1 }}>
          {TABS.map((id) => (
            <Chip
              key={id}
              testID={`board-${id}`}
              label={id === 'all' ? 'All' : (STRATEGY_NAMES[id] ?? id).replace(' Bounce', '')}
              small
              on={tab === id}
              onPress={() => setTab(id)}
            />
          ))}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.s3 }}>
          {lb ? (
            <Text variant="small" style={{ flexShrink: 1, color: theme.color.body }} testID="board-pool">{poolLine(lb, tab, period)}</Text>
          ) : (
            <Bone width={200} height={10} />
          )}
          <Text variant="small" style={{ fontSize: theme.type.t2xs }}>by result</Text>
        </View>

        {rows === null ? (
          <View style={{ gap: theme.space.s3, paddingTop: theme.space.s2 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Bone width={150} height={12} />
                <Bone width={72} height={12} />
              </View>
            ))}
          </View>
        ) : rows.length === 0 ? (
          <Text variant="small" testID="board-empty">
            {period === 'week'
              ? 'Nobody has closed a trade on this board this week. The first one is the whole board.'
              : 'No trades on this board yet.'}
          </Text>
        ) : (
          <FadeIn style={{ gap: 0 }}>
            {rows.map((r, i) => <BoardRow key={`${r.wallet}-${i}`} row={r} rank={i + 1} />)}
          </FadeIn>
        )}

        <Text variant="small" style={{ fontSize: theme.type.t2xs }} testID="board-note">
          {period === 'week'
            ? 'Top 3 by result in each strategy share its pool, 50/30/20 · settled on-chain when the week ends · claimed here.'
            : 'Every trade since launch. The prize is weekly: switch to This week.'}
        </Text>

        <OnChain />

        {lb ? (
          <Text variant="small" style={{ textAlign: 'center', fontSize: theme.type.t2xs }} testID="leaderboard-source">
            {lb.prize
              ? `Prizes paid by contract ${shortAddress(lb.prize.contract)} · week ${lb.prize.week}${lb.prize.winners.length ? ` · last week: ${lb.prize.winners.length} winners` : ''}`
              : 'No prize pool this week'}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/** One wallet's line: rank, who, what they made, what it pays. */
function BoardRow({ row, rank }: { row: Row; rank: number }) {
  const theme = useTheme();
  return (
    <View
      testID={row.you ? 'board-you' : 'board-row'}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space.s3,
        paddingVertical: theme.space.s2,
        borderTopWidth: theme.size.bw,
        borderTopColor: theme.color.hair,
      }}
    >
      <Text variant="small" style={{ width: 20, fontSize: theme.type.t2xs }}>{rank}</Text>
      <Text
        variant={row.you ? 'bodyStrong' : 'num'}
        numberOfLines={1}
        style={{ flex: 1, fontSize: theme.type.tSm, color: theme.color.ink }}
      >
        {row.you ? 'you' : shortAddress(row.wallet)}
      </Text>
      <Text variant="num" signOf={row.pnl} style={{ fontSize: theme.type.tSm }}>{`${money(row.pnl)} AUSD`}</Text>
      <Text
        variant="num"
        style={{ width: 58, textAlign: 'right', fontSize: theme.type.tSm, color: row.prize ? theme.color.ink : theme.color.dim }}
      >
        {row.prize ? `+${row.prize.toFixed(2)}` : ''}
      </Text>
    </View>
  );
}

/**
 * The prize waiting on the contract. Claiming is the wallet's own
 * transaction — the platform publishes the list and can do nothing else.
 */
function ClaimBanner({
  amount,
  contract,
  wallet,
  mine,
  reload,
}: {
  amount: number;
  contract: string;
  wallet: import('@/account/derive').Wallet;
  mine: import('@/exchange/prize').MyPrizes | null;
  reload: () => void;
}) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const claim = async () => {
    if (!mine) return;
    setBusy(true);
    setNotice(null);
    try {
      // Usually one; a wallet that has not been here for a fortnight has more.
      for (const [i, p] of mine.prizes.entries()) {
        if (!p.claimed) await claimPrize(wallet, contract, mine.weeks[i], p.strategy);
      }
      setNotice('In your wallet.');
      reload();
    } catch (e) {
      setNotice(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: theme.space.s2 }} testID="claim-banner">
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.space.s3,
          padding: theme.space.s4,
          borderRadius: theme.radius.rLg,
          backgroundColor: theme.color.fill,
        }}
      >
        <Text variant="bodyStrong" style={{ color: theme.color.onFill, flexShrink: 1 }}>{`Your prize · ${amount.toFixed(2)} AUSD`}</Text>
        <Pressable
          testID="claim"
          accessibilityRole="button"
          accessibilityLabel="Claim your prize"
          disabled={busy}
          onPress={() => void claim()}
          style={({ pressed }) => ({
            paddingVertical: theme.space.s2,
            paddingHorizontal: theme.space.s4,
            borderRadius: theme.radius.rMd,
            backgroundColor: theme.color.onFill,
            opacity: pressed || busy ? 0.7 : 1,
          })}
        >
          <Text variant="bodyStrong" style={{ fontSize: theme.type.tSm, color: theme.color.fill }}>{busy ? 'Claiming…' : 'Claim'}</Text>
        </Pressable>
      </View>
      {notice ? <Text variant="small" testID="claim-notice" style={{ fontSize: theme.type.t2xs }}>{notice}</Text> : null}
    </View>
  );
}

/**
 * What the chain has settled, from the pool indexer. The board above is the
 * platform's account of the week; this is the part nobody can rewrite.
 */
function OnChain() {
  const theme = useTheme();
  const [history, setHistory] = useState<PrizeHistory | null | 'unavailable'>(null);
  useEffect(() => {
    let alive = true;
    api
      .prizeHistory()
      .then((h) => alive && setHistory(h))
      .catch((e) => alive && setHistory(e instanceof ApiError && e.code === 'history_unavailable' ? 'unavailable' : null));
    return () => {
      alive = false;
    };
  }, []);
  if (!history || history === 'unavailable') return null;
  const settled = history.pools.filter((p) => p.settled);
  return (
    <Card style={{ gap: theme.space.s2 }} testID="past-weeks">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.s3 }}>
        <Text variant="caps">On-chain · prize pools</Text>
        <Text variant="small" style={{ fontSize: theme.type.t2xs }}>{`${history.totals.pools} pools · ${micros(history.totals.funded)} AUSD funded`}</Text>
      </View>
      {settled.length === 0 ? (
        <Text variant="small" style={{ fontSize: theme.type.t2xs }}>
          No week settled yet — the first settlement runs when this week ends.
        </Text>
      ) : (
        settled.slice(0, 4).map((p) => (
          <View key={`${p.week}-${p.strategy}`} style={{ gap: 2 }} testID="past-week">
            <Text variant="small" style={{ fontSize: theme.type.t2xs, color: theme.color.body }}>
              {`${STRATEGY_NAMES[p.strategy] ?? p.strategy} · week of ${new Date(p.week_start).toLocaleDateString()} · pool ${micros(p.funded)} AUSD`}
            </Text>
            {p.prizes.map((pr) => (
              <Text key={pr.wallet} variant="num" style={{ fontSize: theme.type.t2xs, color: theme.color.muted }}>
                {`#${pr.rank} ${shortAddress(pr.wallet)} · ${micros(pr.amount)} AUSD · ${pr.claimed ? 'claimed' : 'unclaimed'}`}
              </Text>
            ))}
          </View>
        ))
      )}
      <Text variant="small" style={{ fontSize: theme.type.t2xs, opacity: 0.7 }}>{`Indexed by Envio${history.stale ? ' · last known' : ''}`}</Text>
    </Card>
  );
}

/**
 * Your own standing, whether or not you are on the board.
 *
 * The board carries the top ten; the risk report knows what this wallet did
 * this week and since it started, per strategy — so a player outside the top
 * ten still sees their own line rather than nothing.
 */
function useMyStanding(address: string | null): RiskReport | null {
  const [report, setReport] = useState<RiskReport | null>(null);
  useEffect(() => {
    if (!address) return;
    let alive = true;
    const read = () =>
      api
        .risk()
        .then((r) => alive && setReport(r))
        .catch(() => undefined);
    // Deferred rather than called in the effect body: the first read is a
    // poll like every other, not a render-time state change.
    const first = setTimeout(read, 0);
    const id = setInterval(read, LEADERBOARD_POLL_MS);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [address]);
  return address ? report : null;
}

/** The board's rows: the strategy's standings, or every strategy merged. */
function rank(lb: Leaderboard, tab: Tab, period: Period, address: string | null, mine: RiskReport | null): Row[] {
  const boards = tab === 'all' ? lb.boards : lb.boards.filter((b) => b.id === tab);
  const by = new Map<string, { pnl: number; trades: number }>();
  for (const b of boards) {
    for (const s of b.top) {
      const key = s.wallet.toLowerCase();
      const at = by.get(key) ?? { pnl: 0, trades: 0 };
      by.set(key, { pnl: at.pnl + Number(s.pnl), trades: at.trades + s.trades });
    }
  }

  // Your own line, from the risk report, in case the top ten has no room for
  // it — and as the truth for it when it does: the board is capped, your
  // result is not.
  const own = address ? myPerf(mine, tab, period) : null;
  if (address && own && own.trades > 0) by.set(address, own);

  const rows: Row[] = [...by.entries()]
    .map(([wallet, v]) => ({ wallet, pnl: v.pnl, trades: v.trades, prize: null, you: wallet === address }))
    .sort((a, b) => b.pnl - a.pnl);

  // The prize column is the pool split the way the settlement splits it:
  // top three with a positive result, 50/30/20. A week that has not ended
  // pays nobody yet, so this is what it would pay if it ended now.
  const pool = tab === 'all' || period === 'all' ? 0 : poolOf(lb, tab);
  if (pool > 0) {
    let paid = 0;
    for (const r of rows) {
      if (paid === SHARES.length || r.pnl <= 0) break;
      r.prize = pool * SHARES[paid];
      paid++;
    }
  }
  return rows;
}

/** What this wallet made on the tab's board over the period. */
function myPerf(mine: RiskReport | null, tab: Tab, period: Period): { pnl: number; trades: number } | null {
  if (!mine) return null;
  const perf =
    tab === 'all'
      ? period === 'week'
        ? mine.totals.week
        : mine.totals.all
      : (() => {
          const s = mine.strategies.find((x) => x.id === tab);
          return period === 'week' ? s?.week : s?.all;
        })();
  return perf ? { pnl: Number(perf.pnl), trades: perf.trades } : null;
}

function poolOf(lb: Leaderboard, strategy: string): number {
  return Number(lb.prize?.pools.find((p) => p.strategy === strategy)?.pool ?? 0);
}

/** What the board is playing for, in one line. */
function poolLine(lb: Leaderboard, tab: Tab, period: Period): string {
  const boards: Board[] = tab === 'all' ? lb.boards : lb.boards.filter((b) => b.id === tab);
  const players = boards.reduce((n, b) => n + b.players, 0);
  // Per board it is players; across all three it is entries, because one
  // wallet playing two strategies is counted on both and calling that two
  // players would be a claim about people we have not checked.
  const who = tab === 'all' ? `${players} ${players === 1 ? 'entry' : 'entries'}` : `${players} ${players === 1 ? 'player' : 'players'}`;
  if (period === 'all') return `Since launch · ${who}`;
  const pool = tab === 'all' ? lb.boards.reduce((sum, b) => sum + poolOf(lb, b.id), 0) : poolOf(lb, tab);
  const ends = `ends ${endOfWeek(lb.week_start)}`;
  if (pool <= 0) return `No pool yet · ${who} · ${ends}`;
  return `${tab === 'all' ? 'Pools' : 'Pool'} ${pool.toFixed(2)} AUSD · ${who} · ${ends}`;
}

/** The day the week closes on, from its Monday. */
function endOfWeek(weekStart: string): string {
  const end = new Date(weekStart);
  if (Number.isNaN(end.getTime())) return 'Sunday';
  end.setDate(end.getDate() + 6);
  return end.toLocaleDateString(undefined, { weekday: 'long' });
}

/** Token units (6 decimals) to a short decimal. */
function micros(units: string): string {
  const n = Number(units) / 1e6;
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : units;
}
