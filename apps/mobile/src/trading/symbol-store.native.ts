/**
 * Which market each strategy screen was last on, on the phone.
 */
import * as SecureStore from 'expo-secure-store';

const KEY = 'tradeagent.symbol';

export async function loadSymbols(): Promise<Record<string, string>> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export async function saveSymbols(chosen: Record<string, string>): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(chosen));
  } catch {
    // The choice still holds for this launch.
  }
}
