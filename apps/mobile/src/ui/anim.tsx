/**
 * The small amount of motion the app allows itself.
 *
 * Two rules. A number that stands for money or risk never jumps: it travels
 * to its new value, so the eye sees that it moved and in which direction. And
 * a screen with nothing to show yet is not blank — it draws itself empty and
 * runs its gauges through a sweep, the way a car checks its needles on
 * ignition, then settles them on the real reading.
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
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export type SweepOptions = {
  /** How far the needle swings while there is nothing to show. */
  max?: number;
  /** The self test, out and back. */
  up?: number;
  down?: number;
  /** How long it takes to settle on a real value. */
  settle?: number;
};

/**
 * A number on its way to `target`, or sweeping while `target` is null.
 *
 * Whatever the sweep had reached is where the settle starts from, so the
 * needle never jumps at the moment the data lands — it simply stops swinging
 * and comes to rest on the reading.
 */
export function useSweep(target: number | null, { max = 100, up = 900, down = 800, settle = 800 }: SweepOptions = {}): number {
  const [value, setValue] = useState(0);
  // The last value rendered, so a target arriving mid-sweep is handed over
  // rather than restarted.
  const at = useRef(0);

  useEffect(() => {
    let frame = 0;
    const from = at.current;
    const started = Date.now();
    const step = () => {
      const t = Date.now() - started;
      let next: number;
      if (target === null) {
        const cycle = up + down;
        const phase = t % cycle;
        const swing = phase < up ? max * easeInOut(phase / up) : max * (1 - easeInOut((phase - up) / down));
        // Ease out of wherever the needle was into the first swing, so a
        // sweep that starts part-way through does not snap to zero.
        const blend = Math.min(1, t / up);
        next = from * (1 - blend) + swing * blend;
      } else {
        const k = Math.min(1, t / settle);
        next = from + (target - from) * easeOut(k);
        if (k >= 1) {
          at.current = target;
          setValue(target);
          return;
        }
      }
      at.current = next;
      setValue(next);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, max, up, down, settle]);

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
