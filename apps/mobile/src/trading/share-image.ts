/**
 * The share card on iOS and Android: not drawn yet. The share sheet gets
 * the words and the link; a picture needs a native rasteriser the app does
 * not carry, and a card that is drawn on one platform and captured on the
 * other would be two cards.
 */
import type { ShareTrade } from '@/trading/share';
import type { Theme } from '@/theme';

export async function renderShareCard(_t: ShareTrade, _link: string, _theme: Theme): Promise<File | null> {
  return null;
}
