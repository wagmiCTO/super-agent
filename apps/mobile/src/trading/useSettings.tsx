/**
 * The standard position: what every tap opens.
 *
 * The design moved the three questions a tap used to ask — how much, at what
 * leverage, with what floor — off the trading screen and into one place you
 * set once. The trading screen then shows a single line of what a tap risks,
 * and the tap itself is one press.
 *
 * Stored, because a position you have to re-describe on every visit is not a
 * standard position.
 *
 * The bounds come from the platform's policy engine rather than from the
 * design's placeholder market: offering a size the policy will refuse is a
 * screen that lies, and the refusal would only arrive after the tap.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api } from '@/api/client';
import { loadSettings, saveSettings, type PositionSettings } from '@/trading/settings-store';

export type { PositionSettings };

/** What a tap is worth before the policy engine has said anything. */
export const DEFAULT_SETTINGS: PositionSettings = {
  size: 20,
  leverage: 2,
  stopOn: false,
  stopPercent: 50,
  takeProfitOn: false,
  takeProfitPercent: 50,
  horizonMinutes: 15,
};

export type PositionBounds = {
  minSize: number;
  maxSize: number;
  maxLeverage: number;
  /** True once the platform has said what it actually allows. */
  known: boolean;
};

const FALLBACK_BOUNDS: PositionBounds = { minSize: 5, maxSize: 50, maxLeverage: 3, known: false };

type SettingsState = {
  ready: boolean;
  settings: PositionSettings;
  bounds: PositionBounds;
  update: (change: Partial<PositionSettings>) => void;
};

const SettingsContext = createContext<SettingsState | null>(null);

export function PositionSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PositionSettings>(DEFAULT_SETTINGS);
  const [bounds, setBounds] = useState<PositionBounds>(FALLBACK_BOUNDS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    loadSettings(DEFAULT_SETTINGS).then((stored) => {
      if (!alive) return;
      setSettings(stored);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Asked once: the limits are policy, not a live quote, and the screens that
  // read them are open for seconds.
  useEffect(() => {
    let alive = true;
    api
      .state('direction')
      .then((s) => {
        if (!alive) return;
        setBounds({
          minSize: Number(s.limits.min_notional),
          maxSize: Number(s.limits.max_notional),
          maxLeverage: Number(s.limits.max_leverage),
          known: true,
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // Written on every change rather than on a Done button: the screen has no
  // cancel, so there is nothing to commit.
  const update = useCallback(
    (change: Partial<PositionSettings>) => {
      setSettings((current) => {
        const next = clamp({ ...current, ...change }, bounds);
        void saveSettings(next);
        return next;
      });
    },
    [bounds],
  );

  // A stored position from before the limits were known is brought inside them
  // rather than left to be refused at the tap.
  useEffect(() => {
    if (!ready || !bounds.known) return;
    setSettings((current) => {
      const next = clamp(current, bounds);
      if (next.size === current.size && next.leverage === current.leverage) return current;
      void saveSettings(next);
      return next;
    });
  }, [ready, bounds]);

  const value = useMemo(() => ({ ready, settings, bounds, update }), [ready, settings, bounds, update]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

function clamp(s: PositionSettings, b: PositionBounds): PositionSettings {
  const leverage = Math.min(b.maxLeverage, Math.max(1, s.leverage));
  return {
    ...s,
    leverage,
    size: Math.min(b.maxSize, Math.max(b.minSize, s.size)),
  };
}

export function usePositionSettings(): SettingsState {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('usePositionSettings outside PositionSettingsProvider');
  return ctx;
}

/** What the tap puts in: the position divided by the leverage. */
export function ownStake(s: PositionSettings): number {
  return s.size / Math.max(1, s.leverage);
}

/**
 * The most a tap can lose.
 *
 * With a stop it is the share of your own stake the stop gives up. Without
 * one it is the whole stake — the time limit is the only exit, and saying so
 * plainly is the point of the line.
 */
export function atRisk(s: PositionSettings): number {
  const stake = ownStake(s);
  return s.stopOn ? (stake * s.stopPercent) / 100 : stake;
}

/** What a tap could win, when a take-profit caps it. */
export function possibleWin(s: PositionSettings): number | null {
  return s.takeProfitOn ? (ownStake(s) * s.takeProfitPercent) / 100 : null;
}

/** The stop as the platform wants it: a fraction of the position's collateral. */
export function maxLossFraction(s: PositionSettings): string {
  return s.stopOn ? (s.stopPercent / 100).toFixed(4) : '0';
}
