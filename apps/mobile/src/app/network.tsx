/**
 * A2 — practice or real money.
 *
 * The consent that used to be a screen of its own lives in the right-hand
 * card: choosing mainnet is the moment the user agrees that losses are real,
 * so the card says it rather than a wall of text they would tap past.
 */

import { router } from 'expo-router';
import { View } from 'react-native';

import { useOnboarding } from '@/onboarding/useOnboarding';
import type { NetworkChoice } from '@/onboarding/prefs';
import { Badge, Card, Screen } from '@/ui/surface';
import { Text } from '@/ui/text';
import { useTheme } from '@/theme';

export default function NetworkScreen() {
  const theme = useTheme();
  const { chooseNetwork } = useOnboarding();

  const pick = async (network: NetworkChoice) => {
    await chooseNetwork(network);
    router.push('/intro');
  };

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: theme.space.s4, paddingVertical: theme.space.s6 }}>
        <Text variant="h1">How do you want to start?</Text>

        <Choice
          testID="network-testnet"
          title="Practice"
          badge="⬡ Monad testnet"
          body="Practice money from the exchange. Real prices, real strategies, nothing to lose."
          lead
          onPress={() => pick('testnet')}
        />

        <Choice
          testID="network-mainnet"
          title="Real money"
          badge="⬡ Monad mainnet"
          body="Your own money on a real exchange. You deposit it, every win and loss is real, and you can withdraw any time."
          onPress={() => pick('mainnet')}
        />

        <Text variant="small" style={{ textAlign: 'center' }}>
          You can switch any time in Account.
        </Text>
      </View>
    </Screen>
  );
}

function Choice({
  title, badge, body, lead, onPress, testID,
}: { title: string; badge: string; body: string; lead?: boolean; onPress: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <Card
      testID={testID}
      onPress={onPress}
      style={{
        backgroundColor: theme.color.raised,
        borderWidth: 2,
        borderColor: lead ? theme.color.accent : theme.color.line,
        gap: theme.space.s2,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.s3 }}>
        <Text variant="h2" style={{ fontSize: theme.type.tXl }}>{title}</Text>
        <View style={{ flex: 1 }} />
        <Badge strong={!lead}>{badge}</Badge>
      </View>
      <Text variant="body" style={{ fontSize: theme.type.tSm }}>{body}</Text>
    </Card>
  );
}
