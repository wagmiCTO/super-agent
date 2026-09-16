/**
 * Buttons and the two direction keys.
 *
 * The keys are their own component rather than a Button variant because they
 * carry a rule no other button has: a key is filled when the call is yours to
 * make and outlined while the market has not spoken, and it never changes size
 * or position between those states — the thumb must not have to hunt for it.
 */

import { ActivityIndicator, Pressable, View, type ViewStyle } from 'react-native';

import { Text } from '@/ui/text';
import { face, useTheme, type Theme } from '@/theme';

type Variant = 'primary' | 'outline' | 'danger';

export type ButtonProps = {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  busy?: boolean;
  disabled?: boolean;
  /** Two buttons on one row: the label is a size down and never wraps. */
  small?: boolean;
  testID?: string;
  style?: ViewStyle;
};

export function Button({ title, onPress, variant = 'primary', busy, disabled, small, testID, style }: ButtonProps) {
  const theme = useTheme();
  const off = disabled || busy;
  const { bg, fg, border } = skin(theme, variant, Boolean(off));

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(off) }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        {
          height: small ? 44 : theme.size.btnH,
          borderRadius: theme.radius.rLg,
          backgroundColor: bg,
          borderWidth: variant === 'outline' ? 1 : 0,
          borderColor: border,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: theme.space.s2,
          opacity: pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : null}
      <Text
        numberOfLines={1}
        style={{
          fontFamily: face(theme, 'display', 700),
          fontSize: small ? theme.type.tMd : theme.type.tLg,
          color: fg,
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}

function skin(theme: Theme, variant: Variant, off: boolean) {
  const c = theme.color;
  if (off) return { bg: c.hair, fg: c.dim, border: c.hair };
  if (variant === 'primary') return { bg: c.fill, fg: c.onFill, border: c.fill };
  if (variant === 'danger') return { bg: c.danger, fg: c.onDanger, border: c.danger };
  return { bg: 'transparent', fg: c.ink, border: c.btnLine };
}

export type Side = 'up' | 'down';

export type DirectionKeysProps = {
  onPress: (side: Side) => void;
  /** The side a signal names, or null when the call is entirely yours. */
  recommended?: Side | null;
  /** Direction is a call you make, so both keys stay filled there. */
  alwaysArmed?: boolean;
  disabled?: boolean;
};

export function DirectionKeys({ onPress, recommended = null, alwaysArmed = false, disabled }: DirectionKeysProps) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: theme.space.s3, opacity: disabled ? 0.4 : 1 }}>
      {(['up', 'down'] as const).map((side) => (
        <DirectionKey
          key={side}
          side={side}
          filled={alwaysArmed || recommended === side}
          caption={
            recommended === side ? 'take the signal'
            : recommended ? 'against the signal'
            : side === 'up' ? 'it rises'
            : 'it falls'
          }
          onPress={disabled ? undefined : () => onPress(side)}
        />
      ))}
    </View>
  );
}

function DirectionKey({ side, filled, caption, onPress }: { side: Side; filled: boolean; caption: string; onPress?: () => void }) {
  const theme = useTheme();
  const tint = side === 'up' ? theme.color.up : theme.color.down;
  const on = side === 'up' ? theme.color.onUp : theme.color.onDown;
  const fg = filled ? on : tint;

  return (
    <Pressable
      testID={`key-${side}`}
      accessibilityRole="button"
      accessibilityLabel={side === 'up' ? 'Up' : 'Down'}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        height: theme.size.udH,
        borderRadius: theme.radius.rXl,
        backgroundColor: filled ? tint : 'transparent',
        borderWidth: 2,
        borderColor: tint,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ fontFamily: face(theme, 'display', 700), fontSize: theme.type.tXl, color: fg }}>
        {side === 'up' ? 'Up' : 'Down'}
      </Text>
      <Text style={{ fontFamily: face(theme, 'display', 400), fontSize: theme.type.tXs, color: fg, opacity: 0.7 }}>
        {caption}
      </Text>
    </Pressable>
  );
}
