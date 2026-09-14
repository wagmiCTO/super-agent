/**
 * The theme, as the app sees it.
 *
 * Values live in `constants/theme.ts`, generated from the prototype. This adds
 * the runtime: which skin is active, how to read it, and how to switch it.
 *
 * Two skins ship in the build on purpose. Paper is the default; Terminal is
 * how hardcoded values get caught — anything that does not come from a token
 * stays put when the skin changes, and that is immediately visible.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { DEFAULT_THEME, Themes, face, type Theme, type ThemeName } from '@/constants/theme';

type ThemeContextValue = {
  theme: Theme;
  name: ThemeName;
  setTheme: (name: ThemeName) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children, initial = DEFAULT_THEME }: { children: ReactNode; initial?: ThemeName }) {
  const [name, setName] = useState<ThemeName>(initial);
  const toggleTheme = useCallback(() => setName((n) => (n === 'paper' ? 'terminal' : 'paper')), []);
  const value = useMemo<ThemeContextValue>(
    () => ({ theme: Themes[name], name, setTheme: setName, toggleTheme }),
    [name, toggleTheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The active skin. Throws outside the provider so a missing one is loud. */
export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme outside ThemeProvider');
  return ctx.theme;
}

/** For the dev switcher and anything that needs to name the current skin. */
export function useThemeControls(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeControls outside ThemeProvider');
  return ctx;
}

/**
 * Styles that depend on the theme, memoised per skin.
 *
 * `StyleSheet.create` in a component body rebuilds on every render; this keeps
 * one sheet per skin and hands back the right one.
 */
export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(build: (theme: Theme) => T): T {
  const { theme, name } = useThemeControls();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the skin is the only input
  return useMemo(() => StyleSheet.create(build(theme)), [name]);
}

export { face };
export type { Theme, ThemeName };
