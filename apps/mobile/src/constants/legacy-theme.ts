/**
 * A bridge for screens written before the design, so the build stays green
 * while they are rebuilt one at a time.
 *
 * The old screens asked for `Colors.light.text` and friends. Those names no
 * longer exist: the design has roles (`ink`, `body`, `muted`, `fill`,
 * `accent`, `up`, `down`) rather than a light/dark pair. Everything here maps
 * an old name onto the nearest role in the real theme, so nothing invents a
 * colour of its own.
 *
 * **This file is temporary.** Every screen that moves to `useTheme()` from
 * `@/theme` drops an import here; when the last one goes, so does this.
 * Nothing new should import it.
 */

import { Themes } from '@/constants/theme';
import { Platform } from 'react-native';

const paper = Themes.paper.color;
const terminal = Themes.terminal.color;

/** The old light/dark pair, answered by the two skins we actually ship. */
export const Colors = {
  light: {
    text: paper.ink,
    background: paper.ground,
    backgroundElement: paper.soft,
    backgroundSelected: paper.hair,
    textSecondary: paper.muted,
  },
  dark: {
    text: terminal.ink,
    background: terminal.ground,
    backgroundElement: terminal.soft,
    backgroundSelected: terminal.hair,
    textSecondary: terminal.muted,
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/** The old numeric scale, answered by Paper's spacing. */
export const Spacing = {
  half: 2,
  one: Themes.paper.space.s1 - 1,
  two: Themes.paper.space.s2 - 2,
  three: Themes.paper.space.s3 + 2,
  four: Themes.paper.space.s6 - 4,
  five: Themes.paper.space.s6 + 4,
  six: Themes.paper.space.s6 * 2 + 8,
} as const;

/**
 * The old font stack. New code goes through `face(theme, 'display' | 'num')`,
 * which names a real file; these are the system fallbacks the old screens had.
 */
export const Fonts = Platform.select({
  ios: { sans: 'system-ui', serif: 'ui-serif', rounded: 'ui-rounded', mono: 'ui-monospace' },
  default: { sans: 'normal', serif: 'serif', rounded: 'normal', mono: 'monospace' },
  web: { sans: 'var(--font-display)', serif: 'var(--font-serif)', rounded: 'var(--font-rounded)', mono: 'var(--font-mono)' },
});

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
