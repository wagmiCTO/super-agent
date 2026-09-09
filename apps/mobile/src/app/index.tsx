/**
 * The lobby: the list of strategies, each with this week's board — what it
 * made for everyone, who is up, how many are in right now. The number people
 * argue about is the strategy's total, not any one player's.
 */
import { Link, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAccount } from '@/account/useAccount';
import { api, type Board } from '@/api/client';
import { AccountSection } from '@/components/account';
import { trim } from '@/components/format';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { styles as trading } from '@/components/trading';
import { LEADERBOARD_POLL_MS } from '@/config';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTrading } from '@/trading/useTrading';

const ROUTES: Record<string, Href> = { direction: '/direction', 'ma-cross': '/ma-cross' };

export default function LobbyScreen() {
  const account = useAccount();
  // The account section needs the state; the lobby trades nothing itself.
  const t = useTrading('MON', 'direction');
  const boards = useLeaderboard();

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

          {boards === null ? (
            <ThemedText type="small" themeColor="textSecondary" style={trading.footer}>
              Loading strategies…
            </ThemedText>
          ) : (
            boards.map((b) => <StrategyCard key={b.id} board={b} href={ROUTES[b.id] ?? '/'} />)
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function useLeaderboard(): Board[] | null {
  const [boards, setBoards] = useState<Board[] | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () =>
      api
        .leaderboard()
        .then((lb) => alive && setBoards(lb.boards))
        .catch(() => undefined);
    void read();
    const id = setInterval(read, LEADERBOARD_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return boards;
}

/** One strategy: what it is, what it made this week, who is up, who is in. */
function StrategyCard({ board, href }: { board: Board; href: Href }) {
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

function short(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: Spacing.three, gap: Spacing.one },
});
