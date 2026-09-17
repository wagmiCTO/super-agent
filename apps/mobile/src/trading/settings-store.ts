/**
 * Where the standard position is kept, on the web.
 *
 * Not a secret — a size and a leverage — so it lives in ordinary storage next
 * to what the app remembers about the first visit.
 */

export type PositionSettings = {
  /** Position size in collateral, before leverage. */
  size: number;
  /** The leverage a market gets when none is set for it below. */
  leverage: number;
  /**
   * Leverage by market. Every market has its own ceiling — 3x on MON, 15x
   * on BTC — so one number for all of them was the smallest one's.
   */
  leverageBySymbol?: Record<string, number>;
  stopOn: boolean;
  /** Share of your own stake the stop gives up. */
  stopPercent: number;
  takeProfitOn: boolean;
  takeProfitPercent: number;
  horizonMinutes: number;
};

const KEY = 'tradeagent.position';

/** The stored position, or null when this wallet has never set one. */
export async function loadSettings(): Promise<PositionSettings | null> {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? (JSON.parse(raw) as PositionSettings) : null;
  } catch {
    return null;
  }
}

export async function saveSettings(settings: PositionSettings): Promise<void> {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Blocked storage: the choice still holds for this visit.
  }
}
