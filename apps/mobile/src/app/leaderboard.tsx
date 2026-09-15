/**
 * Leaderboard — named in the design, not built yet. Until it is, the pieces
 * the lobby used to carry live here: the wallet's prizes with their claims,
 * the weeks the chain has settled, and which contract pays.
 */
import { useAccount } from '@/account/useAccount';
import { MyPrizes, PastWeeks, shortAddress, useMyPrizes } from '@/components/prizes';
import { useLeaderboard } from '@/trading/useLeaderboard';
import { StubScreen } from '@/ui/stub';
import { Text } from '@/ui/text';
import { useTheme } from '@/theme';

export default function LeaderboardScreen() {
  const theme = useTheme();
  const account = useAccount();
  const lb = useLeaderboard();
  const unlocked = account.state.status === 'unlocked' ? account.state : null;
  const prizes = useMyPrizes(unlocked?.stored.address ?? null);

  return (
    <StubScreen title="Leaderboard" testID="leaderboard">
      {unlocked && lb?.prize ? <MyPrizes wallet={unlocked.wallet} contract={lb.prize.contract} mine={prizes.mine} reload={prizes.reload} /> : null}
      <PastWeeks />
      {lb ? (
        <Text variant="small" style={{ textAlign: 'center', fontSize: theme.type.t2xs }} testID="leaderboard-source">
          {lb.prize
            ? `Prizes paid by contract ${shortAddress(lb.prize.contract)} · week ${lb.prize.week}${lb.prize.winners.length ? ` · last week: ${lb.prize.winners.length} winners` : ''}`
            : 'No prize pool this week'}
        </Text>
      ) : null}
    </StubScreen>
  );
}
