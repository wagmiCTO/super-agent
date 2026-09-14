/**
 * Type, as the design names it.
 *
 * Every size, weight and face comes from the theme: a screen never picks a
 * font size, and never reaches for `fontWeight` on a custom family, because
 * Android ignores it and silently renders Regular.
 */

import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { face, useTheme, type Theme } from '@/theme';

/** The roles a screen actually asks for, not a list of sizes.
 *  Named `variant` because React Native already owns `role` for ARIA. */
export type TextVariant =
  | 'hero' // the one number a result screen is about
  | 'h1' // screen title
  | 'h2' // section title
  | 'body' // running copy
  | 'bodyStrong'
  | 'small' // secondary line under something
  | 'caps' // the tiny tracked label above a block
  | 'num' // any figure: tabular, monospaced where the skin says so
  | 'numLarge';

export type TextProps = RNTextProps & {
  variant?: TextVariant;
  color?: keyof Theme['color'];
  /** Colour a figure by its sign; pass the value, not a colour. */
  signOf?: number;
};

function styleFor(theme: Theme, variant: TextVariant): TextStyle {
  const { type, color, heading } = theme;
  switch (variant) {
    case 'hero':
      return { fontFamily: face(theme, 'num', 700), fontSize: type.tMega, lineHeight: type.tMega * 1.02, letterSpacing: type.tMega * -0.03, color: color.ink };
    case 'h1':
      return { fontFamily: face(theme, 'display', heading.weight as 600 | 700), fontSize: type.t2xl, lineHeight: type.t2xl * 1.15, letterSpacing: type.t2xl * heading.tracking, color: color.ink };
    case 'h2':
      return { fontFamily: face(theme, 'display', 700), fontSize: type.tLg, lineHeight: type.tLg * 1.25, color: color.ink };
    case 'body':
      return { fontFamily: face(theme, 'display', 400), fontSize: type.tMd, lineHeight: type.tMd * 1.45, color: color.text2 };
    case 'bodyStrong':
      return { fontFamily: face(theme, 'display', 600), fontSize: type.tMd, lineHeight: type.tMd * 1.45, color: color.ink };
    case 'small':
      return { fontFamily: face(theme, 'display', 400), fontSize: type.tSm, lineHeight: type.tSm * 1.4, color: color.muted };
    case 'caps':
      return { fontFamily: face(theme, 'display', 600), fontSize: type.t2xs, lineHeight: type.t2xs * 1.3, letterSpacing: type.t2xs * theme.tracking, textTransform: 'uppercase', color: color.muted };
    case 'num':
      return { fontFamily: face(theme, 'num', 400), fontSize: type.tSm, color: color.ink, fontVariant: ['tabular-nums'] };
    case 'numLarge':
      return { fontFamily: face(theme, 'num', 700), fontSize: type.tHero, lineHeight: type.tHero * 1.05, letterSpacing: type.tHero * -0.02, color: color.ink, fontVariant: ['tabular-nums'] };
  }
}

export function Text({ variant = 'body', color, signOf, style, ...rest }: TextProps) {
  const theme = useTheme();
  const sign =
    signOf === undefined ? undefined
    : signOf > 0.005 ? theme.color.up
    : signOf < -0.005 ? theme.color.down
    : theme.color.ink;
  return <RNText style={[styleFor(theme, variant), color ? { color: theme.color[color] } : null, sign ? { color: sign } : null, style]} {...rest} />;
}

/** `+1.04` / `−25.00` — a minus sign, not a hyphen, and always two decimals. */
export function money(n: number, decimals = 2): string {
  const sign = n > 0.005 ? '+' : n < -0.005 ? '−' : '';
  return sign + Math.abs(n).toFixed(decimals);
}

/** `10 001` — thin groups, the way the prototype shows balances. */
export function grouped(n: number): string {
  return Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');
}
