/**
 * Where the first visit has got to.
 *
 * The flow is linear, so rather than a router of its own it is one question:
 * given what is stored and what the account layer says, which screen is next?
 * Every screen asks that, so a reload or a cold start lands in the same place
 * rather than restarting the promo.
 */

import { useCallback, useEffect, useState } from 'react';

import { EMPTY_PREFS, loadPrefs, savePrefs, type OnboardingPrefs } from '@/onboarding/prefs';

export type OnboardingState = {
  ready: boolean;
  prefs: OnboardingPrefs;
  markIntroSeen: () => Promise<void>;
  markLessonSeen: () => Promise<void>;
  /** Signing in with an existing passkey: the first visit is behind them. */
  markReturning: () => Promise<void>;
};

export function useOnboarding(): OnboardingState {
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

  const markIntroSeen = useCallback(async () => {
    setPrefs((current) => {
      const next = { ...current, introSeen: true };
      void savePrefs(next);
      return next;
    });
  }, []);

  const markLessonSeen = useCallback(async () => {
    setPrefs((current) => {
      const next = { ...current, lessonSeen: true };
      void savePrefs(next);
      return next;
    });
  }, []);

  const markReturning = useCallback(async () => {
    setPrefs((current) => {
      const next = { ...current, introSeen: true, lessonSeen: true };
      void savePrefs(next);
      return next;
    });
  }, []);

  return { ready, prefs, markIntroSeen, markLessonSeen, markReturning };
}

/**
 * The next screen of the first visit, or null once it is over.
 *
 * `hasAccount` is a passkey on the device; `exchangeReady` is that account
 * opened on the exchange. They are separate: a passkey can exist while the
 * three activation transactions have not run, and the visit is not over until
 * the first strategy has been explained.
 */
export function nextStep(
  prefs: OnboardingPrefs,
  hasAccount: boolean,
  exchangeReady: boolean,
): '/intro' | '/passkey' | '/enable' | '/lesson' | null {
  // The promo is for people the app does not recognise. A device that already
  // holds an account has met them, so clearing the stored preferences must not
  // turn a returning user back into a stranger.
  if (!prefs.introSeen && !hasAccount) return '/intro';
  if (!hasAccount) return '/passkey';
  if (!exchangeReady) return '/enable';
  if (!prefs.lessonSeen) return '/lesson';
  return null;
}
