/**
 * When the day's analysis was last read, on a device. Rides on the
 * storage the account layer already uses.
 */

import * as SecureStore from 'expo-secure-store';

const KEY = 'tradeagent.analysis';

export async function loadAnalysisDay(): Promise<string | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? ((JSON.parse(raw) as { day?: string }).day ?? null) : null;
  } catch {
    return null;
  }
}

export async function saveAnalysisDay(day: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify({ day }));
  } catch {
    // Shown again next time.
  }
}
