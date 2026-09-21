/**
 * A4 — the account is a passkey.
 *
 * No password and no seed phrase: the key is derived on the device from the
 * passkey itself. The screen says so plainly, because "no seed phrase" is the
 * part a newcomer is relieved by and a crypto native does not believe.
 */

import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { useAccount } from '@/account/useAccount';
import { useOnboarding } from '@/onboarding/useOnboarding';
import { Button } from '@/ui/button';
import { Mark } from '@/ui/mark';
import { Splash } from '@/ui/splash';
import { Card, Screen } from '@/ui/surface';
import { Text } from '@/ui/text';
import { useBottom, useTop } from '@/ui/inset';
import { useTheme } from '@/theme';

export default function PasskeyScreen() {
  const theme = useTheme();
  const top = useTop(32);
  const bottom = useBottom(theme.space.s6);
  const { state, error, create, signIn } = useAccount();
  const { markReturning } = useOnboarding();
  // Only an unlocked account is signed in. A remembered one is an account on
  // this device whose key is gone with the tab — the session holds the seed,
  // localStorage only the address — and it used to count as signed in here,
  // so the screen handed it straight back to the app. Every request then went
  // out for nobody, the header read SIGN IN, and there was nowhere to do it.
  const signedIn = state.status === 'unlocked';
  const remembered = state.status === 'remembered' ? state.stored : null;
  // Which button was pressed, so the effect below can tell a new account from
  // one that already existed — and so the wait says which of the two is
  // happening. A ref alone would not repaint the screen.
  const [pressed, setPressed] = useState<'create' | 'signIn' | null>(null);
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

  // From the press until the app opens there is nothing on this screen to
  // decide, and what it offers is the opposite of what is happening: someone
  // who pressed "I already have one" was left looking at Create account —
  // through the ceremony, and again in the gap between it and the handoff,
  // where `busy` has already gone quiet. That gap reads as the app having
  // forgotten the sign-in. A loader for the whole of it, and the screen comes
  // back only if the ceremony failed, with the reason on it.
  const waiting = signedIn || (pressed !== null && error === null);
  if (waiting) return <Splash note={pressed === 'signIn' ? 'Signing you in…' : 'Creating your account…'} />;

  const start = (which: 'create' | 'signIn') => {
    setPressed(which);
    returning.current = which === 'signIn';
    void (which === 'signIn' ? signIn() : create());
  };

  return (
    <Screen>
      <View style={{ flex: 1, paddingTop: top, paddingBottom: bottom, gap: theme.space.s5 }}>
        <Mark size={64} />

        <View style={{ gap: theme.space.s3 }}>
          <Text variant="h1">{remembered ? 'Welcome back' : 'Your account is a passkey'}</Text>
          <Text variant="body">
            {remembered
              ? 'Your account is on this device. The key itself is never stored — unlock it with the passkey to trade again.'
              : 'No password, no seed phrase. The key is created on this device and Face ID unlocks it. Nobody else, including us, can withdraw.'}
          </Text>
          {remembered ? (
            <Text variant="small" testID="passkey-remembered">{`${remembered.address.slice(0, 6)}…${remembered.address.slice(-4)}`}</Text>
          ) : null}
        </View>

        {error ? (
          <Card testID="passkey-error" style={{ backgroundColor: theme.color.dangerSoft, borderColor: theme.color.danger }}>
            <Text variant="body" style={{ fontSize: theme.type.tSm, color: theme.color.danger }}>{error}</Text>
          </Card>
        ) : null}

        <View style={{ flex: 1 }} />

        {/* A device that already holds an account is here to unlock it, so
            that is the button; creating another one is the way out of a
            passkey that cannot be found. */}
        <View style={{ gap: theme.space.s3 }}>
          {remembered ? (
            <>
              <Button testID="passkey-signin-primary" title="Sign in" onPress={() => start('signIn')} />
              <Text
                testID="passkey-create-other"
                variant="small"
                style={{ textAlign: 'center', paddingVertical: theme.space.s2 }}
                onPress={() => start('create')}
              >
                Use a different account
              </Text>
            </>
          ) : (
            <>
              <Button testID="passkey-create" title="Create account" onPress={() => start('create')} />
              <Text
                testID="passkey-signin"
                variant="small"
                style={{ textAlign: 'center', paddingVertical: theme.space.s2 }}
                onPress={() => start('signIn')}
              >
                I already have one · Sign in
              </Text>
            </>
          )}
        </View>
      </View>
    </Screen>
  );
}
