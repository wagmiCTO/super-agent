/**
 * A4 — the account is a passkey.
 *
 * No password and no seed phrase: the key is derived on the device from the
 * passkey itself. The screen says so plainly, because "no seed phrase" is the
 * part a newcomer is relieved by and a crypto native does not believe.
 */

import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';

import { useAccount } from '@/account/useAccount';
import { useOnboarding } from '@/onboarding/useOnboarding';
import { Button } from '@/ui/button';
import { Mark } from '@/ui/mark';
import { Card, Screen } from '@/ui/surface';
import { Text } from '@/ui/text';
import { useTheme } from '@/theme';

export default function PasskeyScreen() {
  const theme = useTheme();
  const { state, busy, error, create, signIn } = useAccount();
  const { markReturning } = useOnboarding();
  const signedIn = state.status === 'unlocked' || state.status === 'remembered';
  // Which button was pressed, so the effect below can tell a new account from
  // one that already existed.
  const returning = useRef(false);

  // Once. The handoff used to re-run whenever the preferences changed, because
  // the callbacks it depends on are rebuilt on every write — so a user who had
  // long since left was dragged back to the lesson from wherever they were.
  const handedOff = useRef(false);

  useEffect(() => {
    if (!signedIn || handedOff.current) return;
    handedOff.current = true;
    // Someone signing in with a passkey they already had is not a beginner and
    // goes straight to the app. A brand-new account is offered the first
    // strategy — offered, not required: the lesson is a screen like any other
    // and every way out of it leads into the app.
    // Both land on the entry point, which decides what is still missing —
    // activating the exchange account, most likely. The lesson is not offered
    // here: in the design it opens from the lobby, when a strategy is chosen.
    if (returning.current) void markReturning().then(() => router.replace('/'));
    else router.replace('/');
  }, [signedIn, markReturning]);

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
          <Button testID="passkey-create" title="Create account" busy={busy} onPress={() => { returning.current = false; void create(); }} />
          <Text
            testID="passkey-signin"
            variant="small"
            style={{ textAlign: 'center', paddingVertical: theme.space.s2 }}
            onPress={busy ? undefined : () => { returning.current = true; void signIn(); }}
          >
            I already have one · Sign in
          </Text>
        </View>
      </View>
    </Screen>
  );
}
