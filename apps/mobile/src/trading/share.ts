/**
 * Sharing a trade: the position (or its result), a picture of it, and the
 * wallet's invite link — one share sheet, everything in it.
 *
 * The link is the point: a trade shared without the invite is a brag, with
 * it it is a referral. The picture is the design's share card, drawn by
 * `renderShareCard` where the platform can draw one (the web, today); the
 * text carries the same words for clients that take only text.
 */
import { Platform, Share } from 'react-native';

import { api } from '@/api/client';
import { APP_NAME, STRATEGY_NAMES, WEB_URL } from '@/config';
import { renderShareCard } from '@/trading/share-image';
import { copy } from '@/ui/clipboard';
import { money } from '@/ui/text';
import type { Theme } from '@/theme';

export type ShareTrade = {
  /** Still running, or already closed. */
  kind: 'live' | 'closed';
  strategy: string;
  symbol: string;
  side: 'long' | 'short';
  /** Position value and the leverage on it, in collateral units. */
  notional: number;
  leverage: string;
  /** Unrealized while live, realized once closed. */
  pnl: number;
  /** Live: mm:ss until the horizon closes it. */
  closesIn?: string | null;
  /** Closed: how the market moved, in percent, and who closed it. */
  movePct?: number;
  reason?: string;
  /** Where the wallet stands this week, when known. */
  rank?: { place: number; of: number } | null;
};

export type ShareOutcome = 'shared' | 'copied' | 'failed';

/** The invite link, or the site itself when the wallet has no code yet. */
export async function inviteLink(): Promise<string> {
  try {
    const r = await api.referral();
    return WEB_URL ? `${WEB_URL}/i/${r.code}` : r.link;
  } catch {
    return WEB_URL || 'https://inflight.work';
  }
}

/** The words, for a client that takes only words. */
export function shareText(t: ShareTrade, link: string): string {
  const side = t.side === 'long' ? 'Up' : 'Down';
  const head = `${side} on ${t.symbol} · ${money(t.pnl)} AUSD${t.kind === 'live' ? ' so far' : ''} · ${STRATEGY_NAMES[t.strategy] ?? t.strategy} on ${APP_NAME}`;
  const tail = t.kind === 'live' && t.closesIn ? `Closes in ${t.closesIn}.` : t.rank ? `#${t.rank.place} of ${t.rank.of} this week.` : '';
  return `${head}\n${tail ? `${tail}\n` : ''}Trade with me: ${link}`;
}

/**
 * Opens the share sheet with the card, the words and the link. Where the
 * sheet cannot take a picture the words go alone; where there is no sheet
 * at all the words are copied, so the tap always leaves something to paste.
 */
export async function shareTrade(t: ShareTrade, theme: Theme): Promise<ShareOutcome> {
  const link = await inviteLink();
  const text = shareText(t, link);
  const image = await renderShareCard(t, link, theme).catch(() => null);

  if (Platform.OS === 'web') {
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { canShare?: (d: ShareData) => boolean }) : null;
    if (nav?.share) {
      try {
        if (image && nav.canShare?.({ files: [image] })) {
          await nav.share({ files: [image], text });
          return 'shared';
        }
        await nav.share({ text });
        return 'shared';
      } catch (e) {
        // The person closed the sheet: nothing to copy over.
        if (e instanceof Error && e.name === 'AbortError') return 'failed';
      }
    }
    return (await copy(text)) === 'copied' ? 'copied' : 'failed';
  }

  try {
    const res = await Share.share({ message: text });
    return res.action === Share.sharedAction ? 'shared' : 'failed';
  } catch {
    return 'failed';
  }
}
