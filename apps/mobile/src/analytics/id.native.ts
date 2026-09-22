/**
 * The install's own id, on a phone. See `id.ts` for why it is not the wallet.
 *
 * SecureStore is what the account layer already uses, so this rides along
 * rather than pulling in a second storage dependency for one string.
 */
import * as SecureStore from 'expo-secure-store';

const KEY = 'tradeagent.install';

export async function load(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

export async function save(id: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, id);
  } catch {
    // A device that will not keep it counts as a new install each time.
  }
}
