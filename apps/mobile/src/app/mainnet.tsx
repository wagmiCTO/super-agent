/**
 * Mainnet — what changes when the money is real, and why it is not open yet.
 *
 * The switch on the account screen leads here rather than flipping
 * anything: mainnet is a separate account with its own balance, and the
 * platform has to be ready to hold real money before it offers to. A screen
 * that says so is worth more than a dimmed chip that says nothing.
 */
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { Button } from '@/ui/button';
import { back } from '@/ui/stub';
import { Badge, Card, Row, Screen } from '@/ui/surface';
import { Text } from '@/ui/text';
import { useTheme } from '@/theme';

export default function MainnetScreen() {
  const theme = useTheme();
  return (
    <Screen testID="mainnet">
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1, paddingTop: 52, paddingBottom: theme.space.s6, gap: theme.space.s4 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.s3 }}>
          <Text variant="small" numberOfLines={1} testID="lobby-link" onPress={back}>‹ Back</Text>
          <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: theme.type.tMd, flexShrink: 1 }} testID="stub-title">Mainnet</Text>
          <View style={{ flex: 1 }} />
          <Badge>SOON</Badge>
        </View>

        <View style={{ gap: theme.space.s3 }}>
          <Text variant="h1">Real money, when it is ready</Text>
          <Text variant="body">
            The app trades Monad testnet today: practice money, the same strategies, the same limits. Mainnet is the same
            app over your own money — and that is a step we take once, carefully.
          </Text>
        </View>

        <Card style={{ gap: theme.space.s1 }} testID="mainnet-what">
          {/* One line each: a row that wraps reads as two facts, not one. */}
          <Row label="Account" value="its own balance" />
          <Row label="Passkey" value="the same one" />
          <Row label="Money" value="yours, for real" />
          <Row label="Add · withdraw" value="open there" />
          <Row label="Prizes" value="on-chain, as now" />
        </Card>

        <Text variant="small">
          Nothing carries over: a testnet balance is practice money and stays on testnet. When mainnet opens, this switch
          starts asking for a confirmation instead of showing this screen.
        </Text>

        <View style={{ flex: 1 }} />

        <Button testID="mainnet-back" title="Keep practising" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </ScrollView>
    </Screen>
  );
}
