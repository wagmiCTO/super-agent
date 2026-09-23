/**
 * "Open it on your phone."
 *
 * The product is one thumb wide: the chart, the two keys, the result. On a
 * desktop browser it still works, but it is a phone app in a wide window and
 * reads as one — which is the wrong first impression for somebody who came
 * from a submission link to judge it.
 *
 * So a wide window is asked, once, to switch to a phone. It is an ask and not
 * a wall: the note can be waved away and the app is there underneath.
 */
import { useState } from 'react';
import { Platform, Pressable, View, useWindowDimensions } from 'react-native';

import { Text } from '@/ui/text';
import { useTheme } from '@/theme';

/** Below this the layout is already a phone's, whatever the device is. */
const WIDE = 820;

export function WideScreenNote() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [waved, setWaved] = useState(false);
  if (Platform.OS !== 'web' || width < WIDE || waved) return null;
  return (
    <View
      testID="wide-note"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        padding: theme.space.s4,
        backgroundColor: theme.color.paper,
      }}
    >
      <View style={{ maxWidth: 420, gap: theme.space.s3, alignItems: 'center' }}>
        <Text variant="caps">Tap Trader</Text>
        <Text variant="bodyStrong" style={{ fontSize: theme.type.tLg, textAlign: 'center' }}>
          This one is built for a phone
        </Text>
        <Text variant="small" style={{ textAlign: 'center' }}>
          The chart, the two keys and the result are one thumb wide. On a desktop it works, but it is
          not what it is.
        </Text>
        <Text variant="num" style={{ fontSize: theme.type.tLg, color: theme.color.accent }} testID="wide-note-url">
          inflight.work
        </Text>
        <Text variant="small" style={{ textAlign: 'center', fontSize: theme.type.t2xs }}>
          Open that on your phone — no install, no wallet, no seed phrase.
        </Text>
        <Pressable accessibilityRole="button" onPress={() => setWaved(true)} testID="wide-note-dismiss">
          {({ pressed }) => (
            <Text variant="small" style={{ color: theme.color.accent, opacity: pressed ? 0.6 : 1 }}>
              Look around here anyway
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
