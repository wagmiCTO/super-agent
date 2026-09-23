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

/** A phone's proportions, so a whole screen fits without being cropped. */
const SHOT_RATIO = 393 / 852;
const SHOT_H = 340;

type Step = {
  title: string;
  body: string;
  cta: string;
  href: Href;
  shot?: number;
};

const STEPS: Step[] = [
  {
    title: 'Simple onboarding',
    body: '30 seconds to your first trade: Face ID → the account is open. Your passkey is your private key, kept safe in the device\'s keychain.',
    cta: 'Make one',
    href: '/passkey',
    shot: require('../../assets/judges/passkey.png'),
  },
  {
    title: 'Strategies do the setup',
    body: 'Pick a strategy from the list and go: size, leverage, stop and exit are already decided. Nothing left to configure.',
    cta: 'See the list',
    href: '/',
    shot: require('../../assets/judges/lobby.png'),
  },
  {
    title: 'Trading screen for tap traders',
    body: 'The limits are pre-checked, the strategy is already worked out, and the discipline is ours to keep. All you do is tap. After that the platform owns the exit and closes the position on time, app open or not.',
    cta: 'Open it',
    href: '/direction',
    shot: require('../../assets/judges/direction.png'),
  },
  {
    title: 'We keep you in the game',
    body: 'Every order carries a stop. The day has a loss budget; at zero, the day closes. One button flattens everything. A trader who cannot blow up in an afternoon is still here next week.',
    cta: 'Open Risk',
    href: '/risk',
    shot: require('../../assets/judges/risk.png'),
  },
  {
    title: 'The week pays out on chain',
    body: 'Half the fees your trades pay go into that strategy\'s pool for the week. The pool sits on a contract and settles on chain — 50/30/20 to the top three, claimed by the winners themselves.',
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
            <View style={{ alignItems: 'center' }}>
              <Image
                source={step.shot}
                testID="judges-shot"
                contentFit="contain"
                style={{
                  height: SHOT_H,
                  aspectRatio: SHOT_RATIO,
                  borderRadius: theme.radius.rMd,
                  borderWidth: theme.size.bw,
                  borderColor: theme.color.hair,
                  backgroundColor: theme.color.cardBg,
                }}
              />
            </View>
          ) : null}
          <View style={{ gap: theme.space.s1 }}>
            <Text variant="caps">{`Step ${at + 1} of ${STEPS.length}`}</Text>
            <Text variant="bodyStrong">{step.title}</Text>
            <Text variant="small">{step.body}</Text>
          </View>
          <Button title={step.cta} onPress={() => router.push(step.href)} testID="judges-cta" />
          <View style={{ alignItems: 'center' }}>
            <Dots count={STEPS.length} at={at} />
          </View>
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
