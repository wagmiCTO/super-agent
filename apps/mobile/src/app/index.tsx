/**
 * The lobby: the list of strategies, each with this week's board — what it
 * made for everyone, who is up, how many are in right now. The number people
 * argue about is the strategy's total, not any one player's.
 */
import { Link, type Href } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Wallet } from '@/account/derive';
import { useAccount } from '@/account/useAccount';
import { api, describeError, type Board, type Leaderboard } from '@/api/client';
import { claimPrize, fetchMyPrizes, type MyPrizes } from '@/exchange/prize';
import { AccountSection } from '@/components/account';
import { trim } from '@/components/format';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { styles as trading } from '@/components/trading';
import { LEADERBOARD_POLL_MS } from '@/config';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTrading } from '@/trading/useTrading';

const ROUTES: Record<string, Href> = { direction: '/direction', 'ma-cross': '/ma-cross', box: '/box' };

/** The week's argument: which strategy made the most for its players. */
function factionLine(boards: Board[]): string | null {
  const played = boards.filter((b) => b.trades > 0);
  if (played.length === 0) return null;
  const sorted = [...played].sort((a, b) => Number(b.pnl) - Number(a.pnl));
  const lead = sorted[0];
  const rest = sorted.slice(1).map((b) => `${b.name} ${Number(b.pnl) >= 0 ? '+' : ''}${trim(b.pnl)}`);
  return `${lead.name} leads this week with ${Number(lead.pnl) >= 0 ? '+' : ''}${trim(lead.pnl)}${rest.length ? ` · ${rest.join(' · ')}` : ''}`;
}

export default function LobbyScreen() {
  const account = useAccount();
  // The account section needs the state; the lobby trades nothing itself.
  const t = useTrading('MON', 'direction');
  const lb = useLeaderboard();
  const boards = lb?.boards ?? null;

  return (
    <ThemedView style={trading.root}>
      <SafeAreaView style={trading.safe}>
        <ScrollView contentContainerStyle={trading.content}>
          <View style={trading.header}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              STRATEGIES · THIS WEEK
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t.state ? `Balance ${trim(t.state.account.balance)}` : t.offline ? 'Server unreachable' : 'Loading…'}
            </ThemedText>
          </View>

          <AccountSection account={account} state={t.state} onChange={t.refresh} />

          {boards && factionLine(boards) ? (
            <ThemedText type="smallBold" style={trading.footer} testID="faction-line">
              {factionLine(boards)}
            </ThemedText>
          ) : null}

          {boards === null ? (
            <ThemedText type="small" themeColor="textSecondary" style={trading.footer}>
              Loading strategies…
            </ThemedText>
          ) : (
            boards.map((b) => (
              <StrategyCard key={b.id} board={b} href={ROUTES[b.id] ?? '/'} pool={lb?.prize?.pools.find((p) => p.strategy === b.id)?.pool ?? null} />
            ))
          )}

          {account.state.status === 'unlocked' && lb?.prize ? (
            <MyPrizes wallet={account.state.wallet} address={account.state.stored.address} contract={lb.prize.contract} />
          ) : null}

          {lb ? (
            <ThemedText type="small" themeColor="textSecondary" style={trading.footer} testID="leaderboard-source">
              {lb.prize
                ? `Prizes paid by contract ${short(lb.prize.contract)} · week ${lb.prize.week}${lb.prize.winners.length ? ` · last week: ${lb.prize.winners.length} winners` : ''}`
                : 'No prize pool this week'}
            </ThemedText>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function useLeaderboard(): Leaderboard | null {
  const [lb, setLb] = useState<Leaderboard | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () =>
      api
        .leaderboard()
        .then((next) => alive && setLb(next))
        .catch(() => undefined);
    void read();
    const id = setInterval(read, LEADERBOARD_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return lb;
}

/** One strategy: what it is, what it made this week, who is up, who is in. */
function StrategyCard({ board, href, pool }: { board: Board; href: Href; pool: string | null }) {
  const theme = useTheme();
  const pnl = Number(board.pnl);
  const color = pnl > 0 ? '#16a34a' : pnl < 0 ? '#dc2626' : theme.text;
  return (
    <Link href={href} asChild>
      <Pressable accessibilityRole="button" accessibilityLabel={`Play ${board.name}`} testID={`strategy-${board.id}`}>
        {({ pressed }) => (
          <View style={[styles.card, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 }]}>
            <View style={trading.header}>
              <ThemedText type="subtitle">{board.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {board.active_now > 0 ? `${board.active_now} in now` : 'nobody in'}
              </ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {board.tagline}
            </ThemedText>
            {pool !== null ? (
              <ThemedText type="smallBold" testID={`prize-pool-${board.id}`}>
                Prize pool {trim(pool)} AUSD
              </ThemedText>
            ) : null}
            <View style={trading.header}>
              <ThemedText type="title" style={{ color }} testID={`board-pnl-${board.id}`}>
                {pnl > 0 ? '+' : ''}
                {trim(board.pnl)}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {board.players} {board.players === 1 ? 'player' : 'players'} · {board.trades} {board.trades === 1 ? 'trade' : 'trades'} · {board.rhythm}
              </ThemedText>
            </View>
            {board.top.slice(0, 3).map((s, i) => (
              <View key={s.wallet} style={trading.header}>
                <ThemedText type="code">
                  {i + 1}. {short(s.wallet)}
                </ThemedText>
                <ThemedText type="code" style={{ color: Number(s.pnl) >= 0 ? '#16a34a' : '#dc2626' }}>
                  {Number(s.pnl) > 0 ? '+' : ''}
                  {trim(s.pnl)} · {s.trades}
                </ThemedText>
              </View>
            ))}
          </View>
        )}
      </Pressable>
    </Link>
  );
}

/**
 * The wallet's published prizes, with a claim for each one not taken yet.
 * The claim is the wallet's own transaction, like its activation.
 */
function MyPrizes({ wallet, address, contract }: { wallet: Wallet; address: string; contract: string }) {
  const theme = useTheme();
  const [mine, setMine] = useState<MyPrizes | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(() => {
    fetchMyPrizes(address)
      .then(setMine)
      .catch(() => setMine(null));
  }, [address]);
  useEffect(load, [load]);
  if (!mine || mine.prizes.length === 0) return null;
  const claim = async (i: number) => {
    const p = mine.prizes[i];
    const key = `${mine.weeks[i]}-${p.strategy}`;
    setBusy(key);
    setNotice(null);
    try {
      await claimPrize(wallet, contract, mine.weeks[i], p.strategy);
      setNotice(`Claimed ${trim(p.amount)} AUSD`);
      load();
    } catch (e) {
      setNotice(describeError(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]} testID="my-prizes">
      <ThemedText type="subtitle">Your prizes</ThemedText>
      {mine.prizes.map((p, i) => (
        <View key={`${mine.weeks[i]}-${p.strategy}`} style={trading.header}>
          <ThemedText type="small">
            Week {mine.weeks[i]} · {p.strategy} · {trim(p.amount)} AUSD
          </ThemedText>
          {p.claimed ? (
            <ThemedText type="small" themeColor="textSecondary">
              claimed
            </ThemedText>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Claim ${trim(p.amount)}`}
              disabled={busy !== null}
              onPress={() => void claim(i)}
              style={[trading.smallButton, { backgroundColor: theme.backgroundSelected, opacity: busy ? 0.6 : 1 }]}>
              <ThemedText type="smallBold">Claim</ThemedText>
            </Pressable>
          )}
        </View>
      ))}
      {notice ? (
        <ThemedText type="small" themeColor="textSecondary">
          {notice}
        </ThemedText>
      ) : null}
    </View>
  );
}

function short(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: Spacing.three, gap: Spacing.one },
});
