/**
 * The draft of your own strategy and whether you asked to be told when it
 * opens, on the web. Kept on the device: the platform has no waiting list
 * yet, and a draft is the person's own words, not an order.
 */

export type OwnDraft = { text: string; listed: boolean };

const KEY = 'tradeagent.own';

export async function loadOwnDraft(): Promise<OwnDraft> {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? { text: '', listed: false, ...(JSON.parse(raw) as Partial<OwnDraft>) } : { text: '', listed: false };
  } catch {
    return { text: '', listed: false };
  }
}

export async function saveOwnDraft(draft: OwnDraft): Promise<void> {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Blocked storage: the draft holds for this visit.
  }
}
