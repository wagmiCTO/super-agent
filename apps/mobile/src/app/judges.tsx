/**
 * For judges — the page the submission's live link points at.
 *
 * A judge arrives cold, on a phone, with no account and no reason to trust
 * us. The track asks for a live link *and* instructions, because a judge who
 * lands on a passkey prompt with no explanation closes the tab. So: what to
 * press, where the money comes from, what to look at once inside, and what
 * anyone can check on chain without asking us anything.
 *
 * Not in the app's navigation. It is reached by its URL, from the
 * submission.
 */
import { router } from 'expo-router';
import { Linking, ScrollView, View } from 'react-native';

import { Button } from '@/ui/button';
import { useBottom, useTop } from '@/ui/inset';
import { Card, Screen } from '@/ui/surface';
import { Text } from '@/ui/text';
import { useTheme } from '@/theme';

const REPO = 'https://github.com/wagmiCTO/super-agent';
const POOL = '0x1cC7f88b21E0158e70323aad98Dea4dC20b380aC';
const EXPLORER = `https://testnet.monadexplorer.com/address/${POOL}`;
const INDEXER = 'https://indexer.dev.hyperindex.xyz/45c9bd0/v1/graphql';

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: theme.space.s3 }}>
      <Text variant="num" style={{ color: theme.color.accent, minWidth: 18 }}>{String(n)}</Text>
      <View style={{ flex: 1, gap: theme.space.s1 }}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="small">{body}</Text>
      </View>
    </View>
  );
}

function LinkLine({ label, url, testID }: { label: string; url: string; testID: string }) {
  const theme = useTheme();
  return (
    <Text
      variant="small"
      testID={testID}
      onPress={() => void Linking.openURL(url)}
      style={{ color: theme.color.accent }}
    >
      {label}
    </Text>
  );
}

export default function JudgesScreen() {
  const theme = useTheme();
  const top = useTop();
  const bottom = useBottom(theme.space.s6);
  return (
    <Screen testID="judges">
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: top, paddingBottom: bottom, gap: theme.space.s4 }}
      >
        <View style={{ gap: theme.space.s2 }}>
          <Text variant="bodyStrong" style={{ fontSize: theme.type.tLg }}>For judges</Text>
          <Text variant="small">
            A mobile trading terminal on Perpl. You pick a strategy; the app sets the leverage and the
            size, arms a stop, and closes the position when its horizon ends — whether the phone is
            awake or not.
          </Text>
          <Text variant="small">
            Best opened on a phone. Everything below takes about a minute and costs nothing.
          </Text>
        </View>

        <Card style={{ gap: theme.space.s3 }} testID="judges-steps">
          <Text variant="caps">Sixty seconds</Text>
          <Step
            n={1}
            title="Make a passkey"
            body="One Face ID or Touch ID prompt. No seed phrase, no extension, no wallet app to install first. The passkey is the account."
          />
          <Step
            n={2}
            title="Wait about ten seconds"
            body="The exchange account opens itself and arrives funded with test AUSD. There is nothing to claim and nobody to ask."
          />
          <Step
            n={3}
            title="Open Direction and tap Up or Down"
            body="A three-screen lesson comes first; it can be read or skipped. The tap is the whole decision — the amount, the leverage and the stop are already set."
          />
          <Step
            n={4}
            title="Leave it, or close it"
            body="The position closes itself after fifteen minutes, from our side, even with the app shut. You can also close it by hand and see the result immediately."
          />
        </Card>

        <Card style={{ gap: theme.space.s2 }} testID="judges-look">
          <Text variant="caps">Worth a look once you are in</Text>
          <Text variant="small">
            <Text variant="bodyStrong">Risk</Text> — what is at stake right now across strategies, the
            day&apos;s loss budget, distance to liquidation, the round-trip fee against the market&apos;s
            volatility, and one button that closes everything.
          </Text>
          <Text variant="small">
            <Text variant="bodyStrong">Leaderboard</Text> — this week&apos;s standings, and under them the
            weeks already settled on chain: what each pool held and who claimed it.
          </Text>
          <Text variant="small">
            <Text variant="bodyStrong">The card above the keys</Text> — the asset&apos;s day built from
            Nansen: who has been buying and selling, in one sentence.
          </Text>
          <Text variant="small">
            <Text variant="bodyStrong">Deposit</Text> — a live quote and a real one-time address from
            Aurora Intents, for collateral from any chain.
          </Text>
        </Card>

        <Card style={{ gap: theme.space.s2 }} testID="judges-chain">
          <Text variant="caps">Check it without asking us</Text>
          <Text variant="small">
            Every weekly prize pool is funded from fees the platform actually received, settled on
            chain, and claimed by the winner. None of it needs our word for it.
          </Text>
          <LinkLine label="Prize pool contract on Monad testnet ↗" url={EXPLORER} testID="judges-contract" />
          <LinkLine label="Envio indexer — pools, winners, claims ↗" url={INDEXER} testID="judges-indexer" />
          <LinkLine label="Source, all of it ↗" url={REPO} testID="judges-repo" />
        </Card>

        <Card style={{ gap: theme.space.s2 }} testID="judges-notes">
          <Text variant="caps">Two honest notes</Text>
          <Text variant="small">
            <Text variant="bodyStrong">It is testnet.</Text> The fills, the exchange account and the
            prizes are real and on chain; the money is play money. That is deliberate — we would rather
            learn whether the product holds someone than ask them to risk anything to find out.
          </Text>
          <Text variant="small">
            <Text variant="bodyStrong">If the passkey will not save.</Text> The account is derived
            through the WebAuthn PRF extension, and some password managers do not implement it. Choosing
            the device&apos;s own passkey store — iCloud Keychain or Google Password Manager — gets past it.
          </Text>
        </Card>

        <Button title="Open the app" onPress={() => router.replace('/')} testID="judges-open" />
      </ScrollView>
    </Screen>
  );
}
