/**
 * What the app remembers about the first visit, on the web.
 *
 * None of it is a secret — which network the user picked and whether the
 * promo has been seen — so it lives in ordinary storage next to the account's
 * credential id rather than in the secure store.
 */

export type NetworkChoice = 'testnet' | 'mainnet';

export type OnboardingPrefs = {
  /**
   * Which exchange the account lives on. Only testnet is built, so the first
   * visit no longer asks — a choice with one answer is not a choice. The field
   * stays because Account switches it once mainnet is reachable.
   */
  network: NetworkChoice;
  /** The promo is shown once; skipping counts as seeing it. */
  introSeen: boolean;
  /** The first strategy is taught once; skipping counts as learning it. */
  lessonSeen: boolean;
};

export const EMPTY_PREFS: OnboardingPrefs = { network: 'testnet', introSeen: false, lessonSeen: false };

const KEY = 'tradeagent.onboarding';

export async function loadPrefs(): Promise<OnboardingPrefs> {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? { ...EMPTY_PREFS, ...(JSON.parse(raw) as Partial<OnboardingPrefs>) } : EMPTY_PREFS;
  } catch {
    return EMPTY_PREFS;
  }
}

export async function savePrefs(prefs: OnboardingPrefs): Promise<void> {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Private mode or blocked storage: the choice still holds for this visit.
  }
}

export async function clearPrefs(): Promise<void> {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
