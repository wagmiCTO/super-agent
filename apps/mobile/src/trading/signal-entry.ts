/**
 * Whether a strategy's running position was opened on its signal — the
 * screen's own memory of the tap, kept across a reload. Not a secret and
 * not the platform's business: the venue does not know why a position was
 * opened, only that it was.
 */
const KEY = 'tradeagent.signal-entry';

let cache: Record<string, string> | null = null;

function load(): Record<string, string> {
  if (cache) return cache;
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function save(): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(cache ?? {}));
  } catch {
    // Blocked storage: the memory holds for this visit.
  }
}

/** Remembers that the strategy's next position, on this market, follows its signal. */
export function markSignalEntry(strategy: string, symbol: string): void {
  load()[strategy] = symbol;
  save();
}

/** Whether the strategy's position on this market was opened on its signal. */
export function wasSignalEntry(strategy: string, symbol: string): boolean {
  return load()[strategy] === symbol;
}

/** The position is gone; so is the memory. */
export function clearSignalEntry(strategy: string): void {
  const all = load();
  if (strategy in all) {
    delete all[strategy];
    save();
  }
}
