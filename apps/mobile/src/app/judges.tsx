/**
 * For judges — the page the submission's live link points at.
 *
 * A judge arrives cold, on a phone, with no account and no reason to trust
 * us. The track asks for a live link *and* instructions, and instructions
 * that are a wall of text get skipped. So this is a walk: one step on the
 * screen at a time, a picture of what they are about to see, a line of
 * words, and a button that takes them there.
 *
 * Not in the app's navigation. It is reached by its URL, from the
 * submission.
 */
import { Image } from 'expo-image';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';

import { Button } from '@/ui/button';
import { useBottom, useTop } from '@/ui/inset';
import { Pager } from '@/ui/pager';
import { Card, Dots, Screen } from '@/ui/surface';
import { Text } from '@/ui/text';
import { useTheme } from '@/theme';

const POOL = '0x1cC7f88b21E0158e70323aad98Dea4dC20b380aC';

type Step = {
  title: string;
  body: string;
  cta: string;
  href: Href;
  shot?: number;
};

const STEPS: Step[] = [
  {
    title: 'Three screens, thirty seconds',
    body: 'What this is. Skippable.',
    cta: 'Start',
    href: '/',
    shot: require('../../assets/judges/intro.png'),
  },
  {
    title: 'Your account is a passkey',
    body: 'Face ID makes it. It is your private key — nobody, us included, can move your money.',
    cta: 'Make one',
    href: '/passkey',
    shot: require('../../assets/judges/passkey.png'),
  },
  {
    title: 'Pick a strategy you like',
    body: 'It opens funded. Each card says what the strategy does and how it is going this week.',
    cta: 'Choose one',
    href: '/',
    shot: require('../../assets/judges/lobby.png'),
  },
  {
    title: 'Tap Up or Down',
    body: 'Size, leverage and stop are already set. The tap is the whole decision.',
    cta: 'Open Direction',
    href: '/direction',
    shot: require('../../assets/judges/direction.png'),
  },
  {
    title: 'Hunt for a signal',
    body: '‹ and › walk the markets. A strategy lights up when its shape appears.',
    cta: 'Go looking',
    href: '/direction',
  },
  {
    title: 'See what it is costing you',
    body: 'What is at stake now, the day\'s budget, distance to liquidation. One button closes everything.',
    cta: 'Open Risk',
    href: '/risk',
    shot: require('../../assets/judges/risk.png'),
  },
  {
    title: 'See who won, on chain',
    body: 'Each week pays its top three from the contract. A settled week cannot be changed — by anyone.',
    cta: 'Open the board',
    href: '/leaderboard',
    shot: require('../../assets/judges/leaderboard.png'),
  },
];

export default function JudgesScreen() {
  const theme = useTheme();
  const top = useTop();
  const bottom = useBottom(theme.space.s6);
  const [at, setAt] = useState(0);
  const step = STEPS[at];
  return (
    <Screen testID="judges">
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: top, paddingBottom: bottom, gap: theme.space.s4 }}
      >
        <View style={{ gap: theme.space.s1 }}>
          <Text variant="bodyStrong" style={{ fontSize: theme.type.tLg }}>For judges</Text>
          <Text variant="small">A minute, on a phone. Testnet — nothing costs anything.</Text>
        </View>

        <Card style={{ gap: theme.space.s3 }} testID="judges-step">
          {step.shot ? (
            <Image
              source={step.shot}
              testID="judges-shot"
              contentFit="cover"
              contentPosition="top"
              style={{ width: '100%', height: 260, borderRadius: theme.radius.rMd, backgroundColor: theme.color.cardBg }}
            />
          ) : null}
          <View style={{ gap: theme.space.s1 }}>
            <Text variant="caps">{`Step ${at + 1}`}</Text>
            <Text variant="bodyStrong">{step.title}</Text>
            <Text variant="small">{step.body}</Text>
          </View>
          <Button title={step.cta} onPress={() => router.push(step.href)} testID="judges-cta" />
          <Dots count={STEPS.length} at={at} />
          <Pager
            page={at + 1}
            pages={STEPS.length}
            hasNext={at < STEPS.length - 1}
            onPrev={() => setAt((n) => Math.max(0, n - 1))}
            onNext={() => setAt((n) => Math.min(STEPS.length - 1, n + 1))}
            testID="judges-pager"
          />
        </Card>

        <Card style={{ gap: theme.space.s2 }} testID="judges-chain">
          <Text variant="caps">Check it without asking us</Text>
          <Text
            variant="small"
            testID="judges-contract"
            onPress={() => void Linking.openURL(`https://testnet.monadexplorer.com/address/${POOL}`)}
            style={{ color: theme.color.accent }}
          >
            Prize pool contract ↗
          </Text>
          <Text
            variant="small"
            testID="judges-indexer"
            onPress={() => void Linking.openURL('https://indexer.dev.hyperindex.xyz/45c9bd0/v1/graphql')}
            style={{ color: theme.color.accent }}
          >
            Envio indexer — pools, winners, claims ↗
          </Text>
          <Text
            variant="small"
            testID="judges-repo"
            onPress={() => void Linking.openURL('https://github.com/wagmiCTO/super-agent')}
            style={{ color: theme.color.accent }}
          >
            Source ↗
          </Text>
        </Card>

        <Text variant="small" style={{ fontSize: theme.type.t2xs }} testID="judges-prf">
          If the passkey will not save: some password managers do not support PRF. Use the device&apos;s own
          store — iCloud Keychain or Google Password Manager.
        </Text>
      </ScrollView>
    </Screen>
  );
}
