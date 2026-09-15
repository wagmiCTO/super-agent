/**
 * The small amount of motion the app allows itself.
 *
 * Two rules. A number that stands for money or risk never jumps: it travels
 * to its new value, so the eye sees that it moved and in which direction. And
 * a screen with nothing to show yet is not blank — it draws itself with every
 * instrument at zero and every number replaced by the shape it will have,
 * then everything grows into the reading when it lands.
 *
 * Deliberately plain: a frame loop and a number, rather than a worklet. The
 * pieces that move are leaves — a gauge, a ring, a bar — so the re-render is
 * one small SVG and nothing above it repaints.
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

// The web has no native animated module, and asking for one there is a
// warning in the console on every mount.
const NATIVE = Platform.OS !== 'web';

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * A number on its way to `target`, starting from wherever it already was.
 *
 * `null` is "no reading yet", and the answer to that is zero: an instrument
 * that has nothing to show shows nothing, and the first reading is watched
 * growing into place rather than found already there.
 */
export function useGrow(target: number | null, { settle = 800 }: { settle?: number } = {}): number {
  const [value, setValue] = useState(0);
  // The last value rendered, so a new target is travelled to from here.
  const at = useRef(0);

  useEffect(() => {
    const to = target ?? 0;
    const from = at.current;
    if (from === to) return;
    let frame = 0;
    const started = Date.now();
    const step = () => {
      const k = Math.min(1, (Date.now() - started) / settle);
      const next = from + (to - from) * easeOut(k);
      at.current = next;
      setValue(next);
      if (k >= 1) {
        at.current = to;
        setValue(to);
        return;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, settle]);

  return value;
}

/**
 * Content arriving: up a few pixels and in. Opacity and transform only, so
 * the animation runs off the render thread and nothing re-renders for it.
 */
export function FadeIn({ children, delay = 0, style }: { children: React.ReactNode; delay?: number; style?: ViewStyle }) {
  const [t] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 420, delay, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }).start();
  }, [t, delay]);
  return (
    <Animated.View style={[style, { opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

/**
 * A line of the screen that is not here yet: the shape the real thing will
 * have, breathing gently so it reads as loading rather than as broken.
 */
export function Bone({ width = '100%', height = 12, radius }: { width?: number | `${number}%`; height?: number; radius?: number }) {
  const theme = useTheme();
  const [t] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE }),
        Animated.timing(t, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t]);
  return (
    <Animated.View
      style={{
        width,
        height,
        borderRadius: radius ?? height / 2,
        backgroundColor: theme.color.hair,
        opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }),
      }}
    />
  );
}

/** A card-shaped hole in the screen, with `lines` bones in it. */
export function BoneCard({ lines = 3, testID }: { lines?: number; testID?: string }) {
  const theme = useTheme();
  return (
    <View
      testID={testID}
      style={{
        gap: theme.space.s3,
        padding: theme.space.s4,
        borderRadius: theme.radius.rLg,
        backgroundColor: theme.color.cardBg,
        borderWidth: theme.color.cardLine === 'transparent' ? 0 : theme.size.bw,
        borderColor: theme.color.cardLine,
      }}
    >
      {Array.from({ length: lines }, (_, i) => (
        <Bone key={i} width={i === 0 ? '46%' : i % 2 ? '88%' : '70%'} height={i === 0 ? 10 : 12} />
      ))}
    </View>
  );
}
