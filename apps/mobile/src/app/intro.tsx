/**
 * A3 — one screen, then the passkey.
 *
 * It used to be three slides of argument. A tester got through them and called
 * the whole thing marketing, so now it says what the app is, how long a trade
 * takes and what the money is, and the only button leaves.
 */

import { router } from 'expo-router';
import { View } from 'react-native';

import { useOnboarding } from '@/onboarding/useOnboarding';
import { Button } from '@/ui/button';
import { CopilotScene } from '@/ui/illustration';
import { Mark } from '@/ui/mark';
import { APP_NAME } from '@/config';
import { Badge, Screen } from '@/ui/surface';
import { Text } from '@/ui/text';
import { useBottom, useTop } from '@/ui/inset';
import { useTheme } from '@/theme';

export default function IntroScreen() {
  const theme = useTheme();
  const top = useTop();
  const bottom = useBottom(theme.space.s6);
  const { markIntroSeen } = useOnboarding();

  const leave = async () => {
    await markIntroSeen();
    router.replace('/passkey');
  };

  return (
    <Screen>
      <View style={{ flex: 1, paddingTop: top, paddingBottom: bottom, gap: theme.space.s5 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.s3 }}>
          <Mark size={24} />
          <Text variant="bodyStrong" style={{ fontSize: theme.type.tSm }}>{APP_NAME}</Text>
          <Badge>testnet</Badge>
          <View style={{ flex: 1 }} />
          <Text variant="small" testID="intro-skip" onPress={leave}>Skip</Text>
        </View>

        <CopilotScene />

        <View style={{ gap: theme.space.s3 }}>
          <Text variant="h1">Up or down. Fifteen minutes.</Text>
          <Text variant="body">
            Tap which way Bitcoin goes. A stop guards the trade, and fifteen minutes later you see the result. Practice money — nothing to lose.
          </Text>
        </View>

        <View style={{ flex: 1 }} />

        <Button testID="intro-next" title="Let's go" onPress={leave} />
      </View>
    </Screen>
  );
}
