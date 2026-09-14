/**
 * The screens written before the design read a flat light/dark palette here.
 * They keep working through the bridge while they are rebuilt.
 *
 * New code uses `useTheme()` from `@/theme`, which hands back the real theme
 * with its roles, metrics and faces.
 */

import { Colors } from '@/constants/legacy-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function useTheme() {
  const scheme = useColorScheme();
  return Colors[scheme === 'unspecified' ? 'light' : scheme];
}
