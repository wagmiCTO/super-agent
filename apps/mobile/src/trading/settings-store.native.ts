/**
 * Where the standard position is kept, on a device.
 *
 * SecureStore is what the account layer already uses, so this rides along
 * rather than pulling in a second storage dependency.
 */

import * as SecureStore from 'expo-secure-store';

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

/** The stored position, or null when this wallet has never set one. */
export async function loadSettings(): Promise<PositionSettings | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as PositionSettings) : null;
  } catch {
    return null;
  }
}

export async function saveSettings(settings: PositionSettings): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(settings));
  } catch {
    // The choice still holds for this launch.
  }
}
