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
  /** The policy's ceiling on leverage, across every market it allows. */
  maxLeverage: number;
  /** Each market's own ceiling, by symbol: what the venue accepts there. */
  marketMaxLeverage: Record<string, number>;
  /** The fee the venue takes off the collateral when a position opens, as a fraction of its value. */
  openFee: number;
  /** True once the platform has said what it actually allows. */
  known: boolean;
};

const FALLBACK_BOUNDS: PositionBounds = { minSize: 5, maxNotional: 50, balance: 0, maxLeverage: 3, marketMaxLeverage: {}, openFee: 0, known: false };

/** The most leverage a market allows: its own ceiling, under the policy's. */
export function maxLeverageFor(bounds: PositionBounds, symbol: string): number {
  const own = bounds.marketMaxLeverage[symbol.toUpperCase()];
  return Math.max(1, Math.min(bounds.maxLeverage, own && own > 0 ? own : bounds.maxLeverage));
}

/**
 * The leverage a tap on this market opens at: the one set for the market,
 * else the standard one, never above what the market allows.
 */
export function leverageFor(s: PositionSettings, bounds: PositionBounds, symbol: string): number {
  const set = s.leverageBySymbol?.[symbol.toUpperCase()] ?? s.leverage;
  return Math.min(maxLeverageFor(bounds, symbol), Math.max(1, set));
}

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

/**
 * The standard position the app proposes once it knows what is allowed:
 * sized for the home market, at the most leverage that market allows. The
 * other markets start at the same leverage and go up from there by hand.
 */
function standardPosition(bounds: PositionBounds): Pick<PositionSettings, 'size' | 'leverage'> {
  const leverage = maxLeverageFor(bounds, DEFAULT_SYMBOL);
  return { leverage, size: Math.min(maxSizeFor(bounds, leverage), DEFAULT_STAKE * leverage) };
}

type SettingsState = {
  ready: boolean;
  settings: PositionSettings;
  bounds: PositionBounds;
  update: (change: Partial<PositionSettings>) => void;
  /** The settings as a tap on this market reads them: its own leverage in place of the standard one. */
  forMarket: (symbol: string) => PositionSettings;
  /** The leverage for one market; the size stays the same for every market. */
  setLeverage: (symbol: string, leverage: number) => void;
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
        // The policy's ceiling spans every market it allows; each market's
        // own is what the venue accepts there, and the slider on a market
        // runs to that market's number.
        const maxLeverage = Number(s.limits.max_leverage);
        const marketMaxLeverage: Record<string, number> = {};
        for (const m of markets) {
          const own = Number(m.max_leverage);
          if (Number.isFinite(own) && own > 0) marketMaxLeverage[m.symbol.toUpperCase()] = own;
        }
        // On a venue that charges the whole round trip at the open, the
        // open is what the balance has to cover.
        const openFee = fees ? Number(fees.charged_on === 'open-only' ? fees.round_trip_taker : fees.taker_rate) + Number(fees.builder_rate) : 0;
        setBounds({
          minSize: Number(s.limits.min_notional),
          maxNotional: Number(s.limits.max_notional),
          balance: Number(s.account.balance),
          maxLeverage: Number.isFinite(maxLeverage) && maxLeverage > 0 ? maxLeverage : FALLBACK_BOUNDS.maxLeverage,
          marketMaxLeverage,
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

  const forMarket = useCallback((symbol: string): PositionSettings => ({ ...settings, leverage: leverageFor(settings, bounds, symbol) }), [settings, bounds]);

  const setLeverage = useCallback(
    (symbol: string, leverage: number) => {
      setSettings((current) => {
        const key = symbol.toUpperCase();
        const lev = Math.min(maxLeverageFor(bounds, key), Math.max(1, Math.round(leverage)));
        const next = clamp({ ...current, leverageBySymbol: { ...current.leverageBySymbol, [key]: lev } }, bounds);
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

  const value = useMemo(() => ({ ready, settings, bounds, update, forMarket, setLeverage, refresh }), [ready, settings, bounds, update, forMarket, setLeverage, refresh]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

function clamp(s: PositionSettings, b: PositionBounds): PositionSettings {
  const leverage = Math.min(maxLeverageFor(b, DEFAULT_SYMBOL), Math.max(1, s.leverage));
  const bySymbol: Record<string, number> = {};
  for (const [sym, lev] of Object.entries(s.leverageBySymbol ?? {})) {
    if (Number.isFinite(lev) && lev > 0) bySymbol[sym.toUpperCase()] = Math.min(maxLeverageFor(b, sym), Math.max(1, lev));
  }
  // The size is one number for every market, so it is bounded by the most
  // any of them can back. A market at less leverage may not back all of
  // it; the trading screen says so before the tap and offers what fits.
  const most = Math.max(leverage, ...Object.values(bySymbol));
  return {
    ...s,
    leverage,
    leverageBySymbol: bySymbol,
    size: Math.min(maxSizeFor(b, most), Math.max(b.minSize, s.size)),
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
