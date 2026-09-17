/**
 * When the day's analysis was last read, on the web. It is shown once a
 * day, on the first strategy screen opened; the date is all there is to keep.
 */

const KEY = 'tradeagent.analysis';

export async function loadAnalysisDay(): Promise<string | null> {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? ((JSON.parse(raw) as { day?: string }).day ?? null) : null;
  } catch {
    return null;
  }
}

export async function saveAnalysisDay(day: string): Promise<void> {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify({ day }));
  } catch {
    // Blocked storage: shown again next time, which is the lesser harm.
  }
}
