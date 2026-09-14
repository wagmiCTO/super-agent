/**
 * Where the first visit has got to.
 *
 * The flow is linear, so rather than a router of its own it is one question:
 * given what is stored and what the account layer says, which screen is next?
 * Every screen asks that, so a reload or a cold start lands in the same place
 * rather than restarting the promo.
 *
 * The answer lives in one provider rather than in each screen. It used to be
 * per-component state, and screens overwrote each other: the lesson loaded its
 * own copy before the promo's "seen" had landed, then wrote that stale copy
 * back. A user who had just registered and reloaded was sent through the promo
 * again.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { EMPTY_PREFS, loadPrefs, savePrefs, type OnboardingPrefs } from '@/onboarding/prefs';

export type OnboardingState = {
  ready: boolean;
  prefs: OnboardingPrefs;
  markIntroSeen: () => Promise<void>;
  markLessonSeen: () => Promise<void>;
  /** True once a strategy's lesson has been offered. */
  taught: (strategy: string) => boolean;
  markTaught: (strategy: string) => Promise<void>;
  /** Signing in with an existing passkey: the first visit is behind them. */
  markReturning: () => Promise<void>;
};

const OnboardingContext = createContext<OnboardingState | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<OnboardingPrefs>(EMPTY_PREFS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    loadPrefs().then((loaded) => {
      if (!alive) return;
      setPrefs(loaded);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const patch = useCallback(async (change: Partial<OnboardingPrefs>) => {
    // Merge onto what is stored, not onto what this render happens to hold:
    // two screens can be mounted at once while one replaces the other.
    const stored = await loadPrefs();
    const next = { ...stored, ...change };
    setPrefs(next);
    await savePrefs(next);
  }, []);

  const value = useMemo<OnboardingState>(
    () => ({
      ready,
      prefs,
      markIntroSeen: () => patch({ introSeen: true }),
      markLessonSeen: () => patch({ lessonSeen: true }),
      taught: (strategy: string) => prefs.taught.includes(strategy),
      markTaught: async (strategy: string) => {
        const stored = await loadPrefs();
        if (stored.taught.includes(strategy)) return;
        await patch({ taught: [...stored.taught, strategy] });
      },
      markReturning: () => patch({ introSeen: true, lessonSeen: true, taught: ['direction', 'ma-cross', 'rsi'] }),
    }),
    [ready, prefs, patch],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingState {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error('useOnboarding outside OnboardingProvider');
  return ctx;
}

/**
 * The next screen of the first visit, or null once it is over.
 *
 * `hasAccount` is a passkey on the device; `exchangeReady` is that account
 * opened on the exchange. They are separate: a passkey can exist while the
 * activation transactions have not run.
 */
export function nextStep(
  prefs: OnboardingPrefs,
  hasAccount: boolean,
  exchangeReady: boolean,
): '/intro' | '/passkey' | '/enable' | null {
  // The promo is for people the app does not recognise. A device that already
  // holds an account has met them, so clearing the stored preferences must not
  // turn a returning user back into a stranger.
  if (!prefs.introSeen && !hasAccount) return '/intro';
  if (!hasAccount) return '/passkey';
  if (!exchangeReady) return '/enable';
  // The lesson is deliberately absent. It is offered once, by the passkey
  // screen, at the moment an account is created; after that the app is open.
  // As a gate condition it locked the user in: every route back to the entry
  // point returned them here.
  return null;
}
