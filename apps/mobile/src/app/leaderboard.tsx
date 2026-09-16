/**
 * Leaderboard and prizes — one screen, as the design draws it.
 *
 * Four tabs (a strategy each, then all of them together), a This week / All
 * time switch, the board itself, and above it the prize to claim when the
 * chain has published one.
 *
 * The board is ranked by **volume traded**, as the design has it: the number
 * people compete on is how much they played, and the result rides along.
 * The on-chain settlement still picks winners by result (ADR 0004); until
 * that rule is changed the screen does not project who wins what.
 *
 * Every number here comes from somewhere: the standings and the pools from
 * `/v1/leaderboard`, your own line from `/v1/risk` (which knows your week and
 * your all-time per strategy even when you are nowhere near the top ten), the
 * prize you can take from `/v1/prizes` and the contract itself.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { useAccount } from '@/account/useAccount';
import { api, ApiError, describeError, type Leaderboard, type PrizeHistory, type Standing, type Standings } from '@/api/client';
import { shortAddress, unclaimedTotal, useMyPrizes } from '@/components/prizes';
import { PAGE_SIZE, STRATEGY_NAMES } from '@/config';
import { copy } from '@/ui/clipboard';
import { claimPrize } from '@/exchange/prize';
import { useLeaderboard } from '@/trading/useLeaderboard';
import { Bone, FadeIn } from '@/ui/anim';
import { Pager } from '@/ui/pager';
import { back } from '@/ui/stub';
import { Card, Chip, Screen } from '@/ui/surface';
import { Text, grouped, money } from '@/ui/text';
import { useTheme } from '@/theme';

type Period = 'week' | 'all';
type Tab = 'direction' | 'ma-cross' | 'rsi' | 'all';
type You = NonNullable<Standings['you']>;

const TABS: Tab[] = ['direction', 'ma-cross', 'rsi', 'all'];

/** One line of the board. */
type Row = { wallet: string; volume: number; pnl: number; trades: number; you: boolean };

export default function LeaderboardScreen() {
  const theme = useTheme();
  const [period, setPeriod] = useState<Period>('week');
  const [tab, setTab] = useState<Tab>('direction');
  const lb = useLeaderboard(period);
  const account = useAccount();
  const knows = account.state.status !== 'loading';
  const unlocked = account.state.status === 'unlocked' ? account.state : null;
  const address = (unlocked?.stored.address ?? null)?.toLowerCase() ?? null;
  const prizes = useMyPrizes(lb?.prize && address ? address : null);
  const claimable = unclaimedTotal(prizes.mine);

  const board = useStandings(tab, period, knows);
  const rows = board.rows ? rank(board.rows, address) : null;
  // Your own line, from the platform with its rank, for as long as the page
  // it belongs to is not loaded.
  const own = rows && board.you && !rows.some((r) => r.you) ? board.you : null;

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
            <Text variant="small" style={{ flexShrink: 1, color: theme.color.body }} testID="board-pool">{poolLine(lb, tab, period, board.players)}</Text>
          ) : (
            <Bone width={200} height={10} />
          )}
          <Text variant="small" style={{ fontSize: theme.type.t2xs }}>by volume</Text>
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
            {rows.map((r, i) => <BoardRow key={`${r.wallet}-${i}`} row={r} rank={(board.page - 1) * PAGE_SIZE + i + 1} />)}
            {board.pages > 1 ? (
              <View style={{ paddingTop: theme.space.s3 }}>
                <Pager page={board.page} pages={board.pages} hasNext={board.page < board.pages} onPrev={board.prev} onNext={board.next} busy={board.loading} testID="board-pager" />
              </View>
            ) : null}
            {own ? (
              <View style={{ marginTop: theme.space.s2, borderTopWidth: theme.size.bw, borderTopColor: theme.color.line }}>
                <BoardRow row={{ wallet: own.wallet, volume: Number(own.volume ?? 0), pnl: Number(own.pnl), trades: own.trades, you: true }} rank={own.rank} />
              </View>
            ) : null}
          </FadeIn>
        )}

        <Text variant="small" style={{ fontSize: theme.type.t2xs }} testID="board-note">
          {period === 'week'
            ? 'Ranked by what you traded this week · the pool is settled on-chain when the week ends · claimed here.'
            : 'Everything traded since launch. The prize is weekly: switch to This week.'}
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

/** One wallet's line: rank, who, what they traded, and what it made them. */
function BoardRow({ row, rank }: { row: Row; rank: number | null }) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const take = async () => {
    const res = await copy(row.wallet);
    if (res === 'copied') {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
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
      <Text variant="small" style={{ width: 20, fontSize: theme.type.t2xs }}>{rank ?? '·'}</Text>
      <Text
        variant={row.you ? 'bodyStrong' : 'num'}
        numberOfLines={1}
        style={{ flexShrink: 1, fontSize: theme.type.tSm, color: theme.color.ink }}
      >
        {row.you ? 'you' : copied ? 'Copied' : shortAddress(row.wallet)}
      </Text>
      {/* The whole address, one tap away: a short one is for reading, not for finding on the explorer. */}
      <Pressable
        testID="board-copy"
        accessibilityRole="button"
        accessibilityLabel="Copy the address"
        onPress={() => void take()}
        hitSlop={8}
        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, marginRight: 'auto' })}
      >
        <CopyGlyph size={13} color={copied ? theme.color.accent : theme.color.dim} />
      </Pressable>
      <View style={{ alignItems: 'flex-end', gap: 1 }}>
        <Text variant="num" style={{ fontSize: theme.type.tSm }} testID="board-volume">{`${grouped(row.volume)} AUSD`}</Text>
        <Text variant="num" signOf={row.pnl} style={{ fontSize: theme.type.t2xs }}>{`${money(row.pnl)} · ${row.trades} ${row.trades === 1 ? 'trade' : 'trades'}`}</Text>
      </View>
    </View>
  );
}

/** Two sheets, one over the other: the sign for "copy" everywhere. */
function CopyGlyph({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={9} y={9} width={12} height={12} rx={2} />
      <Path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Svg>
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
 * One board, a page at a time.
 *
 * The standings come ordered and counted from the platform — a board is a
 * table that grows, and the first screen of it must not wait for the rest.
 * Pages already read are kept, so going back is free. Your own line is
 * pinned under the page until the page it belongs to is shown: a board that
 * shows everyone but you is the one board nobody wants.
 */
function useStandings(tab: Tab, period: Period, ready: boolean) {
  const key = `${tab}:${period}`;
  // Keyed by the board it belongs to, so switching tabs shows nothing
  // rather than the other board's rows for a frame.
  const [book, setBook] = useState<{ key: string; pages: Standing[][]; players: number; next: number | null; you: You | null; at: number }>({ key: '', pages: [], players: 0, next: null, you: null, at: 0 });
  const [loading, setLoading] = useState(false);
  const current = book.key === key;

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const first = setTimeout(() => {
      api
        .standings(tab, period)
        .then((answer) => {
          if (!alive) return;
          setBook({ key, pages: [answer.standings], players: answer.players, next: answer.next_offset ?? null, you: answer.you ?? null, at: 0 });
        })
        .catch(() => alive && setBook({ key, pages: [[]], players: 0, next: null, you: null, at: 0 }));
    }, 0);
    return () => {
      alive = false;
      clearTimeout(first);
    };
  }, [tab, period, ready, key]);

  const next = useCallback(() => {
    if (!current || loading) return;
    if (book.at + 1 < book.pages.length) {
      setBook((have) => ({ ...have, at: have.at + 1 }));
      return;
    }
    if (book.next === null) return;
    setLoading(true);
    api
      .standings(tab, period, book.next)
      .then((answer) => {
        setBook((have) =>
          have.key === key
            ? { key, pages: [...have.pages, answer.standings], players: answer.players, next: answer.next_offset ?? null, you: answer.you ?? have.you, at: have.pages.length }
            : have,
        );
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [tab, period, book.at, book.pages.length, book.next, loading, current, key]);

  const prev = useCallback(() => {
    if (!current || book.at === 0) return;
    setBook((have) => ({ ...have, at: Math.max(0, have.at - 1) }));
  }, [current, book.at]);

  return {
    rows: current ? (book.pages[book.at] ?? null) : null,
    players: book.players,
    you: current ? book.you : null,
    page: book.at + 1,
    pages: Math.max(1, Math.ceil(book.players / PAGE_SIZE)),
    next,
    prev,
    loading,
  };
}

/** The page as the screen draws it: whose line is yours. */
function rank(standings: Standing[], address: string | null): Row[] {
  return standings.map((s) => ({
    wallet: s.wallet.toLowerCase(),
    volume: Number(s.volume ?? 0),
    pnl: Number(s.pnl),
    trades: s.trades,
    you: s.wallet.toLowerCase() === address,
  }));
}

function poolOf(lb: Leaderboard, strategy: string): number {
  return Number(lb.prize?.pools.find((p) => p.strategy === strategy)?.pool ?? 0);
}

/** What the board is playing for, in one line. */
function poolLine(lb: Leaderboard | null, tab: Tab, period: Period, players: number): string {
  const who = `${players} ${players === 1 ? 'trader' : 'traders'}`;
  if (period === 'all') return `Since launch · ${who}`;
  if (!lb) return who;
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
