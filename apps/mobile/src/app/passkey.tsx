/**
 * A4 — the account is a passkey.
 *
 * No password and no seed phrase: the key is derived on the device from the
 * passkey itself. The screen says so plainly, because "no seed phrase" is the
 * part a newcomer is relieved by and a crypto native does not believe.
 */

import { router } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

import { useAccount } from '@/account/useAccount';
import { Button } from '@/ui/button';
import { Mark } from '@/ui/mark';
import { Card, Screen } from '@/ui/surface';
import { Text } from '@/ui/text';
import { useTheme } from '@/theme';

export default function PasskeyScreen() {
  const theme = useTheme();
  const { state, busy, error, create, signIn } = useAccount();
  const signedIn = state.status === 'unlocked' || state.status === 'remembered';

  useEffect(() => {
    // The passkey prompt is the last step of the first visit; once it answers,
    // the app proper takes over.
    if (signedIn) router.replace('/');
  }, [signedIn]);

  return (
    <Screen>
      <View style={{ flex: 1, paddingTop: 72, paddingBottom: theme.space.s6, gap: theme.space.s5 }}>
        <Mark size={64} />

        <View style={{ gap: theme.space.s3 }}>
          <Text variant="h1">Your account is a passkey</Text>
          <Text variant="body">
            No password, no seed phrase. The key is created on this device and Face ID unlocks it. Nobody else,
            including us, can withdraw.
          </Text>
        </View>

        {error ? (
          <Card testID="passkey-error" style={{ backgroundColor: theme.color.dangerSoft, borderColor: theme.color.danger }}>
            <Text variant="body" style={{ fontSize: theme.type.tSm, color: theme.color.danger }}>{error}</Text>
          </Card>
        ) : null}

        <View style={{ flex: 1 }} />

        <View style={{ gap: theme.space.s3 }}>
          <Button testID="passkey-create" title="Create account" busy={busy} onPress={() => void create()} />
          <Text
            testID="passkey-signin"
            variant="small"
            style={{ textAlign: 'center', paddingVertical: theme.space.s2 }}
            onPress={busy ? undefined : () => void signIn()}
          >
            I already have one · Sign in
          </Text>
        </View>
      </View>
    </Screen>
  );
}
