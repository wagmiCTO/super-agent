/**
 * Which market each strategy screen was last on, on the web. Not a secret:
 * ordinary storage, next to the standard position.
 */

const KEY = 'tradeagent.symbol';

export async function loadSymbols(): Promise<Record<string, string>> {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export async function saveSymbols(chosen: Record<string, string>): Promise<void> {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(chosen));
  } catch {
    // Blocked storage: the choice still holds for this visit.
  }
}
