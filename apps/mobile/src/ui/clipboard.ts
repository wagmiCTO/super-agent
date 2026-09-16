/**
 * Getting one string out of the app — an address, an invite link.
 *
 * No clipboard module: on the web the browser's own clipboard does it, and
 * on a phone the share sheet is where copying lives anyway, so a tap gets
 * the same string with one more choice about where it goes. Returns what
 * happened, so the screen can say "Copied" only when it was.
 */
import { Platform, Share } from 'react-native';

export async function copy(text: string): Promise<'copied' | 'shared' | 'failed'> {
  if (Platform.OS === 'web') {
    try {
      await navigator.clipboard.writeText(text);
      return 'copied';
    } catch {
      return 'failed';
    }
  }
  try {
    const res = await Share.share({ message: text });
    return res.action === Share.sharedAction ? 'shared' : 'failed';
  } catch {
    return 'failed';
  }
}
