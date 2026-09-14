/**
 * Where the standard position is kept, on the web.
 *
 * Not a secret — a size and a leverage — so it lives in ordinary storage next
 * to what the app remembers about the first visit.
 */

export type PositionSettings = {
  /** Position size in collateral, before leverage. */
  size: number;
  leverage: number;
  stopOn: boolean;
  /** Share of your own stake the stop gives up. */
  stopPercent: number;
  takeProfitOn: boolean;
  takeProfitPercent: number;
  horizonMinutes: number;
};

const KEY = 'tradeagent.position';

export async function loadSettings(fallback: PositionSettings): Promise<PositionSettings> {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<PositionSettings>) } : fallback;
  } catch {
    return fallback;
  }
}

export async function saveSettings(settings: PositionSettings): Promise<void> {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Blocked storage: the choice still holds for this visit.
  }
}
