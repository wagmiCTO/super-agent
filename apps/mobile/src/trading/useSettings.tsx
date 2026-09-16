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
import { DEFAULT_SYMBOL } from '@/config';
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

/**
 * What the app opens with when nothing has been set: this much of your own
 * money, at the most leverage allowed. A first standard position has to be a
 * real one — a number small enough to lose and large enough to feel.
 */
export const DEFAULT_STAKE = 100;

export type PositionBounds = {
  minSize: number;
  /** The policy engine's cap on one position, in collateral units. */
  maxNotional: number;
  /** Free collateral in the exchange account: what a position can be backed with. */
  balance: number;
  maxLeverage: number;
  /** The fee the venue takes off the collateral when a position opens, as a fraction of its value. */
  openFee: number;
  /** True once the platform has said what it actually allows. */
  known: boolean;
};

const FALLBACK_BOUNDS: PositionBounds = { minSize: 5, maxNotional: 50, balance: 0, maxLeverage: 3, openFee: 0, known: false };

/**
 * The room left for the fill to land a little worse than the quote, and for
 * the lot to round: a position sized to the last cent of the wallet is one
 * the venue refuses at the first tick against it.
 */
const FILL_ROOM = 0.01;

/**
 * The largest position that can actually be opened at this leverage.
 *
 * A position is backed by your own collateral: the margin it locks is its
 * value divided by the leverage, so the wallet can carry `balance × leverage`
 * and no more. The policy engine caps it again, lower. Showing the policy cap
 * alone — the whole of it, whatever the wallet holds — was a screen offering
 * a size the venue would refuse for want of margin.
 *
 * With no account yet there is no balance to divide, and the policy cap is
 * all there is to say.
 */
export function maxSizeFor(bounds: PositionBounds, leverage: number): number {
  const lev = Math.max(1, leverage);
  // The wallet pays the margin and the opening fee out of the same balance:
  // N / L + f · N ≤ B, so N ≤ B · L / (1 + f · L), and a little less than that.
  const backed = (bounds.balance * (1 - FILL_ROOM) * lev) / (1 + bounds.openFee * lev);
  const cap = backed > 0 ? Math.min(bounds.maxNotional, backed) : bounds.maxNotional;
  return Math.max(bounds.minSize, Math.floor(cap));
}

/** The standard position the app proposes once it knows what is allowed. */
function standardPosition(bounds: PositionBounds): Pick<PositionSettings, 'size' | 'leverage'> {
  const leverage = bounds.maxLeverage;
  return { leverage, size: Math.min(maxSizeFor(bounds, leverage), DEFAULT_STAKE * leverage) };
}

type SettingsState = {
  ready: boolean;
  settings: PositionSettings;
  bounds: PositionBounds;
  update: (change: Partial<PositionSettings>) => void;
  /** Re-read the limits and the balance; the form does it as it opens. */
  refresh: () => void;
};

const SettingsContext = createContext<SettingsState | null>(null);

export function PositionSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PositionSettings>(DEFAULT_SETTINGS);
  const [bounds, setBounds] = useState<PositionBounds>(FALLBACK_BOUNDS);
  const [ready, setReady] = useState(false);
  // Nothing stored yet: the app still owes this wallet its first standard
  // position, and it can only be proposed once the limits are known.
  const [unset, setUnset] = useState(false);

  useEffect(() => {
    let alive = true;
    loadSettings().then((stored) => {
      if (!alive) return;
      setSettings(stored ? { ...DEFAULT_SETTINGS, ...stored } : DEFAULT_SETTINGS);
      setUnset(stored === null);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // The limits are policy rather than a live quote, but the balance they are
  // read with is not: it moves with every round trip and every deposit. So
  // this is asked on mount and again whenever a screen opens the form.
  const refresh = useCallback(() => {
    Promise.all([api.state('direction'), api.markets().catch(() => [])])
      .then(([s, markets]) => {
        const home = markets.find((m) => m.symbol === DEFAULT_SYMBOL);
        const fees = home?.fees;
        // The policy's ceiling spans every market it allows; the standard
        // position is sized for the home market, whose own ceiling is lower.
        // A screen on a bigger market caps at the same number, never above.
        const maxLeverage = Math.min(Number(s.limits.max_leverage), home ? Number(home.max_leverage) : Number(s.limits.max_leverage));
        // On a venue that charges the whole round trip at the open, the
        // open is what the balance has to cover.
        const openFee = fees ? Number(fees.charged_on === 'open-only' ? fees.round_trip_taker : fees.taker_rate) + Number(fees.builder_rate) : 0;
        setBounds({
          minSize: Number(s.limits.min_notional),
          maxNotional: Number(s.limits.max_notional),
          balance: Number(s.account.balance),
          maxLeverage: Number.isFinite(maxLeverage) && maxLeverage > 0 ? maxLeverage : Number(s.limits.max_leverage),
          openFee: Number.isFinite(openFee) ? openFee : 0,
          known: true,
        });
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

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

  // A wallet that has never set a position gets the standard one as soon as
  // the limits arrive; a stored position from before they were known is
  // brought inside them rather than left to be refused at the tap.
  useEffect(() => {
    if (!ready || !bounds.known) return;
    setSettings((current) => {
      const next = clamp(unset ? { ...current, ...standardPosition(bounds) } : current, bounds);
      if (next.size === current.size && next.leverage === current.leverage) return current;
      void saveSettings(next);
      return next;
    });
    if (unset) setUnset(false);
  }, [ready, bounds, unset]);

  const value = useMemo(() => ({ ready, settings, bounds, update, refresh }), [ready, settings, bounds, update, refresh]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

function clamp(s: PositionSettings, b: PositionBounds): PositionSettings {
  const leverage = Math.min(b.maxLeverage, Math.max(1, s.leverage));
  return {
    ...s,
    leverage,
    // The ceiling follows the leverage: less leverage is less the wallet can
    // back, so a size set at 3x has to come down when the slider does.
    size: Math.min(maxSizeFor(b, leverage), Math.max(b.minSize, s.size)),
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

/** The target the same way: the share of the collateral that banks the win. */
export function takeProfitFraction(s: PositionSettings): string {
  return s.takeProfitOn ? (s.takeProfitPercent / 100).toFixed(4) : '0';
}
