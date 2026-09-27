/**
 * The screens written before the design read a flat palette here. They keep
 * working through the bridge while they are rebuilt, and follow the skin the
 * app is in rather than the phone's own light/dark setting.
 *
 * New code uses `useTheme()` from `@/theme`, which hands back the real theme
 * with its roles, metrics and faces.
 */

import { legacyColors } from '@/constants/legacy-theme';
import { useTheme as useSkin } from '@/theme';

export function useTheme() {
  return legacyColors(useSkin());
}
