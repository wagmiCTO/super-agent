/**
 * The app's own ground while something is being worked out.
 *
 * Shown wherever a screen has nothing to offer yet — the entry point deciding
 * where a visit resumes, the passkey screen between the ceremony and the app.
 * A screen that is waiting must not leave its buttons standing: the last thing
 * a user pressed is the thing they think is happening, and a live "Create
 * account" under a sign-in ceremony says the wrong one.
 */

import { useEffect, useState } from 'react';
import { Animated, Easing, Platform, View } from 'react-native';

import { APP_NAME } from '@/config';
import { Mark } from '@/ui/mark';
import { Text } from '@/ui/text';
import { useTheme } from '@/theme';

const TRACK = 120;
const CHIP = 48;

export function Splash({ note }: { note?: string }) {
  const theme = useTheme();
  return (
    <View
      testID="splash"
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.space.s5, backgroundColor: theme.color.ground }}
    >
      <Mark size={84} />
      <Text variant="h1" style={{ fontSize: theme.type.tXl }}>{APP_NAME}</Text>
      <Bar />
      {note ? <Text variant="small">{note}</Text> : null}
    </View>
  );
}

/**
 * The wait, moving. A bar filled to a fixed fraction says the app knows how
 * far along it is, which it does not — and after a second of not moving it
 * says the app has stopped, which it has not.
 */
function Bar() {
  const theme = useTheme();
  const [t] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
    );
    loop.start();
    return () => loop.stop();
  }, [t]);
  return (
    <View style={{ width: TRACK, height: 3, borderRadius: 999, backgroundColor: theme.color.hair, overflow: 'hidden' }}>
      <Animated.View
        style={{
          height: 3,
          width: CHIP,
          borderRadius: 999,
          backgroundColor: theme.color.accent,
          transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [-CHIP, TRACK] }) }],
        }}
      />
    </View>
  );
}
