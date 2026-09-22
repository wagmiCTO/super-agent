/**
 * The install's own id, on the web: the tab's local storage.
 *
 * Not the wallet. The address is public on the chain, but joining it to a
 * session in an analytics database builds a profile of a person, which is not
 * what counting a funnel needs.
 */
const KEY = 'tradeagent.install';

export async function load(): Promise<string | null> {
  try {
    return globalThis.localStorage?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

export async function save(id: string): Promise<void> {
  try {
    globalThis.localStorage?.setItem(KEY, id);
  } catch {
    // Blocked storage: a new id per visit, which undercounts returns and
    // breaks nothing.
  }
}
