/**
 * Account — named in the design, not built yet. Until it is, the account
 * layer the lobby used to carry lives here: the passkey row, sign out, the
 * activation card, and the way to add funds.
 */
import { router } from 'expo-router';

import { useAccount } from '@/account/useAccount';
import { AccountSection } from '@/components/account';
import { useTrading } from '@/trading/useTrading';
import { StubScreen } from '@/ui/stub';
import { Text } from '@/ui/text';
import { useTheme } from '@/theme';

export default function AccountScreen() {
  const theme = useTheme();
  const account = useAccount();
  const t = useTrading('MON', 'direction');

  return (
    <StubScreen title="Account" testID="account">
      <AccountSection account={account} state={t.state} onChange={t.refresh} />
      <Text variant="small" testID="deposit-link" onPress={() => router.push('/deposit')} style={{ color: theme.color.accent }}>
        Add funds
      </Text>
    </StubScreen>
  );
}
