/**
 * "Open it on your phone."
 *
 * The product is one thumb wide: the chart, the two keys, the result. In a
 * desktop window it still runs, but it reads as a phone app stretched out —
 * the wrong first impression for somebody who arrived from a submission link
 * to judge it.
 *
 * So a wide window gets the phone instead: the trading screen inside a frame,
 * and the address to open. No way past it, because there is nothing past it
 * worth seeing at this width.
 */
import { Image } from 'expo-image';
import { Platform, View, useWindowDimensions } from 'react-native';

import { Text } from '@/ui/text';
import { useTheme } from '@/theme';

/** Below this the layout is already a phone's, whatever the device is. */
const WIDE = 820;
const RATIO = 393 / 852;
const PHONE_H = 520;

export function WideScreenNote() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  if (Platform.OS !== 'web' || width < WIDE) return null;
  return (
    <View
      testID="wide-note"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.space.s6,
        padding: theme.space.s5,
        backgroundColor: theme.color.paper,
      }}
    >
      <Image
        source={require('../../assets/judges/direction.png')}
        testID="wide-note-shot"
        contentFit="contain"
        style={{
          height: PHONE_H,
          aspectRatio: RATIO,
          borderRadius: theme.radius.rLg,
          borderWidth: theme.size.bw,
          borderColor: theme.color.hair,
          backgroundColor: theme.color.cardBg,
        }}
      />
      <View style={{ maxWidth: 360, gap: theme.space.s3 }}>
        <Text variant="caps">Tap Trader</Text>
        <Text variant="bodyStrong" style={{ fontSize: theme.type.tLg }}>
          Built for a phone
        </Text>
        <Text variant="small">
          The chart, the two keys and the result are one thumb wide. This is the whole product, and it
          belongs in a hand.
        </Text>
        <Text variant="num" style={{ fontSize: theme.type.tLg, color: theme.color.accent }} testID="wide-note-url">
          inflight.work
        </Text>
        <Text variant="small" style={{ fontSize: theme.type.t2xs }}>
          Open that on your phone. No install, no wallet, no seed phrase.
        </Text>
      </View>
    </View>
  );
}
