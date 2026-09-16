/**
 * Surfaces, rows and the small pieces that sit on them.
 *
 * Depth is a theme decision, not a screen one: Paper lifts a card with a soft
 * shadow on white, Terminal draws a hairline on a raised panel. A screen asks
 * for `Card` and gets whichever the skin means.
 */

import { Pressable, View, type ViewProps, type ViewStyle } from 'react-native';

import { Text } from '@/ui/text';
import { useTheme } from '@/theme';

export function Screen({ children, style, ...rest }: ViewProps) {
  const theme = useTheme();
  return (
    // `paper`, not `ground`: in the prototype `ground` is the stage the phone
    // stands on, and every screen inside the phone is drawn on paper.
    <View style={[{ flex: 1, backgroundColor: theme.color.paper, paddingHorizontal: theme.space.s5 }, style]} {...rest}>
      {children}
    </View>
  );
}

export function Card({ children, style, onPress, testID }: { children: React.ReactNode; style?: ViewStyle; onPress?: () => void; testID?: string }) {
  const theme = useTheme();
  const base: ViewStyle = {
    backgroundColor: theme.color.cardBg,
    borderRadius: theme.radius.rLg,
    borderWidth: theme.color.cardLine === 'transparent' ? 0 : theme.size.bw,
    borderColor: theme.color.cardLine,
    padding: theme.space.s4,
    gap: theme.space.s3,
    ...(theme.elevated
      ? { shadowColor: theme.color.ink, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 }
      : null),
  };
  if (!onPress) return <View style={[base, style]} testID={testID}>{children}</View>;
  return (
    <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [base, { opacity: pressed ? 0.75 : 1 }, style]}>
      {children}
    </Pressable>
  );
}

/** Label on the left, value on the right — the shape most of the app is made of. */
export function Row({ label, value, tone }: { label: string; value: string; tone?: number }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.space.s3 }}>
      <Text variant="small" style={{ color: theme.color.body, flexShrink: 1 }}>{label}</Text>
      <Text variant="num" signOf={tone} style={{ fontSize: theme.type.tSm }}>{value}</Text>
    </View>
  );
}

export function Badge({ children, strong }: { children: string; strong?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingVertical: theme.space.s1,
        paddingHorizontal: theme.space.s2,
        borderRadius: theme.radius.rSm,
        borderWidth: theme.size.bw,
        borderColor: strong ? theme.color.accent : theme.color.line,
        backgroundColor: strong ? theme.color.accent : 'transparent',
      }}
    >
      {/* The design's badge is a size up from the caps label above a block. */}
      <Text variant="caps" style={{ fontSize: theme.type.tXs, lineHeight: theme.type.tXs * 1.3, color: strong ? theme.color.onAccent : theme.color.text2 }}>{children}</Text>
    </View>
  );
}

/** `small` is the tab-sized chip: a row of four has to fit a phone. */
export function Chip({ label, on, small, center, onPress, testID }: { label: string; on?: boolean; small?: boolean; center?: boolean; onPress?: () => void; testID?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(on) }}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: small ? theme.space.s1 : theme.space.s2,
        paddingHorizontal: small ? theme.space.s2 : theme.space.s3,
        borderRadius: theme.radius.rMd,
        borderWidth: theme.size.bw,
        borderColor: on ? theme.color.accent : theme.color.line,
        backgroundColor: on ? theme.color.accent : 'transparent',
        alignItems: center ? 'center' : 'flex-start',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text variant="bodyStrong" style={{ fontSize: small ? theme.type.tXs : theme.type.tSm, color: on ? theme.color.onAccent : theme.color.body }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** The dots that say how far through a lesson or a carousel you are. */
export function Dots({ count, at }: { count: number; at: number }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: theme.space.s2 }}>
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={{
            width: 22,
            height: 4,
            borderRadius: 999,
            backgroundColor: i <= at ? theme.color.accent : theme.color.hair,
          }}
        />
      ))}
    </View>
  );
}

export function Toggle({ on, onPress, testID }: { on: boolean; onPress?: () => void; testID?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={{
        width: 44,
        height: 26,
        borderRadius: 999,
        padding: 3,
        backgroundColor: on ? theme.color.accent : theme.color.line,
        alignItems: on ? 'flex-end' : 'flex-start',
      }}
    >
      <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: theme.color.paper }} />
    </Pressable>
  );
}

/** A progress bar that fills within itself rather than switching on and off. */
export function Progress({ value, tone }: { value: number; tone?: string }) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, height: 6, borderRadius: 999, backgroundColor: theme.color.hair, overflow: 'hidden' }}>
      <View style={{ height: 6, width: `${Math.max(0, Math.min(100, value))}%`, borderRadius: 999, backgroundColor: tone ?? theme.color.accent }} />
    </View>
  );
}
