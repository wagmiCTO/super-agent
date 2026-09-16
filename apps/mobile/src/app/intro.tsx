/**
 * A3 — three slides, then the passkey.
 *
 * Skip is as prominent as Next on purpose: nothing here is a gate, and a
 * reader who already knows what the app is should not have to tap through an
 * argument for it.
 */

import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { useOnboarding } from '@/onboarding/useOnboarding';
import { Button } from '@/ui/button';
import { CopilotScene, CrowdScene, DisciplineScene } from '@/ui/illustration';
import { Mark } from '@/ui/mark';
import { APP_NAME } from '@/config';
import { Badge, Dots, Screen } from '@/ui/surface';
import { Text } from '@/ui/text';
import { useTheme } from '@/theme';

const SLIDES = [
  {
    title: 'Be the smartest one in the market',
    body: 'Join the 0.01% who trade with AI and real strategies. Everyone else is at the casino.',
    Scene: CrowdScene,
  },
  {
    title: 'Your trading copilot',
    body: 'Not a wealth button. A tool that makes you a sharper trader: strategies to follow, then your own to build, skills that compound.',
    Scene: CopilotScene,
  },
  {
    title: 'This is where you get good',
    body: 'A plan on every trade, a stop, a daily budget. A streak to protect, a board to climb. Discipline you can feel in a week.',
    Scene: DisciplineScene,
  },
] as const;

export default function IntroScreen() {
  const theme = useTheme();
  const { markIntroSeen } = useOnboarding();
  const [at, setAt] = useState(0);
  const slide = SLIDES[at];

  const leave = async () => {
    await markIntroSeen();
    router.replace('/passkey');
  };

  return (
    <Screen>
      <View style={{ flex: 1, paddingTop: 52, paddingBottom: theme.space.s6, gap: theme.space.s5 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.s3 }}>
          <Mark size={24} />
          <Text variant="bodyStrong" style={{ fontSize: theme.type.tSm }}>{APP_NAME}</Text>
          <Badge>testnet</Badge>
          <View style={{ flex: 1 }} />
          <Text variant="small" testID="intro-skip" onPress={leave}>Skip</Text>
        </View>

        <slide.Scene />

        <Dots count={SLIDES.length} at={at} />

        <View style={{ gap: theme.space.s3 }}>
          <Text variant="h1">{slide.title}</Text>
          <Text variant="body">{slide.body}</Text>
        </View>

        <View style={{ flex: 1 }} />

        <Button
          testID="intro-next"
          title={at < SLIDES.length - 1 ? 'Next' : "Let's go"}
          onPress={() => (at < SLIDES.length - 1 ? setAt(at + 1) : leave())}
        />
      </View>
    </Screen>
  );
}
