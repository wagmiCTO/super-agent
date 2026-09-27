/**
 * Where the chosen appearance is kept, on the web.
 *
 * Light or dark is not a secret, so it lives in ordinary storage next to the
 * position settings.
 */

import type { ThemeName } from '@/constants/theme';

const KEY = 'tradeagent.theme';

/** The skin this browser chose, or null when it never chose one. */
export async function loadThemeChoice(): Promise<ThemeName | null> {
  try {
    return parse(globalThis.localStorage?.getItem(KEY) ?? null);
  } catch {
    return null;
  }
}

export async function saveThemeChoice(name: ThemeName): Promise<void> {
  try {
    globalThis.localStorage?.setItem(KEY, name);
  } catch {
    // Blocked storage: the choice still holds for this visit.
  }
}

/** Only the skins a person can pick; anything else is no choice at all. */
export function parse(raw: string | null): ThemeName | null {
  return raw === 'paper' || raw === 'night' ? raw : null;
}
