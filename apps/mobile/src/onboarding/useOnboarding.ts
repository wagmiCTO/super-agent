/**
 * Where the first visit has got to.
 *
 * The flow is linear, so rather than a router of its own it is one question:
 * given what is stored and what the account layer says, which screen is next?
 * Every screen asks that, so a reload or a cold start lands in the same place
 * rather than restarting the promo.
 */

import { useCallback, useEffect, useState } from 'react';

import { EMPTY_PREFS, loadPrefs, savePrefs, type NetworkChoice, type OnboardingPrefs } from '@/onboarding/prefs';

export type OnboardingState = {
  ready: boolean;
  prefs: OnboardingPrefs;
  chooseNetwork: (network: NetworkChoice) => Promise<void>;
  markIntroSeen: () => Promise<void>;
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

  const chooseNetwork = useCallback(async (network: NetworkChoice) => {
    setPrefs((current) => {
      const next = { ...current, network };
      void savePrefs(next);
      return next;
    });
  }, []);

  const markIntroSeen = useCallback(async () => {
    setPrefs((current) => {
      const next = { ...current, introSeen: true };
      void savePrefs(next);
      return next;
    });
  }, []);

  return { ready, prefs, chooseNetwork, markIntroSeen };
}

/**
 * The next screen of the first visit, or null once it is over.
 *
 * `hasAccount` comes from the account layer: a passkey that is remembered or
 * unlocked means the promo and the network question are behind us even if the
 * stored preferences were cleared.
 */
export function nextStep(prefs: OnboardingPrefs, hasAccount: boolean): '/network' | '/intro' | '/passkey' | null {
  if (hasAccount) return null;
  if (!prefs.network) return '/network';
  if (!prefs.introSeen) return '/intro';
  return '/passkey';
}
