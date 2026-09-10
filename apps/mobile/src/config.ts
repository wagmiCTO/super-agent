/**
 * Runtime configuration.
 *
 * The API base URL is the one thing that differs between where the app runs:
 *
 * - web build / iOS simulator / Android emulator with adb reverse: localhost
 * - a physical phone: the laptop's LAN address, and the platform must listen
 *   on 0.0.0.0 (PLATFORM_ADDR=0.0.0.0:8080)
 *
 * Set EXPO_PUBLIC_API_URL to override; Expo inlines EXPO_PUBLIC_* at build time.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080').replace(/\/$/, '');

/**
 * Where the web build (and the chart page, public/tv.html) is served from.
 * On web it is the page's own origin. On a phone it must be reachable from
 * the device: Metro on the laptop's LAN address in development, the site in
 * production. Set EXPO_PUBLIC_WEB_URL to override; by default it follows the
 * API host on Metro's port.
 */
export const WEB_URL = (
  process.env.EXPO_PUBLIC_WEB_URL ??
  (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : API_URL.replace(/:\d+$/, ':8081'))
).replace(/\/$/, '');

/** How often the screen re-reads account state, in milliseconds. */
export const STATE_POLL_MS = 2000;

/** How often a strategy screen re-reads its signal, in milliseconds. */
export const SIGNAL_POLL_MS = 5000;

/** How often a strategy screen re-reads the market context card, in milliseconds. */
export const CONTEXT_POLL_MS = 5 * 60_000;

/** How often the lobby re-reads the leaderboard, in milliseconds. */
export const LEADERBOARD_POLL_MS = 10_000;

/** Notional presets the player can pick, in collateral units. */
export const NOTIONAL_PRESETS = ['5', '10', '20', '50'] as const;

/** Leverage the Direction strategy trades at. MON allows at most 3x. */
export const DEFAULT_LEVERAGE = '2';

/** The market the Direction strategy opens on by default. */
export const DEFAULT_SYMBOL = 'MON';

/**
 * Horizons the Direction strategy offers: the platform closes the position
 * when the horizon ends. "Evening" is 20:00 local time — tonight, or
 * tomorrow's if it is already past.
 */
export const HORIZON_PRESETS = ['15m', '1h', 'Evening'] as const;
export type Horizon = (typeof HORIZON_PRESETS)[number];

export function horizonSeconds(h: Horizon, now = new Date()): number {
  switch (h) {
    case '15m':
      return 15 * 60;
    case '1h':
      return 60 * 60;
    case 'Evening': {
      const evening = new Date(now);
      evening.setHours(20, 0, 0, 0);
      if (evening.getTime() - now.getTime() < 60_000) evening.setDate(evening.getDate() + 1);
      return Math.round((evening.getTime() - now.getTime()) / 1000);
    }
  }
}

/**
 * Each strategy's slot in the key family the passkey derives (ADR 0005 in
 * the repository docs): its exchange API key is HMAC(seed, domain ‖ index).
 * Part of the derivation — never renumber; the platform's catalog agrees.
 */
export const STRATEGY_KEY_INDEX: Record<string, number> = { direction: 0, 'ma-cross': 1, rsi: 2 };

/** The strategies' names as the lobby shows them, by id. */
export const STRATEGY_NAMES: Record<string, string> = { direction: 'Direction', 'ma-cross': 'MA Cross', rsi: 'RSI Bounce' };

/**
 * Stops a strategy screen offers: the share of the position's collateral
 * the platform may let it lose before closing it. "Off" leaves the exit to
 * the horizon and, past that, to the exchange's liquidation.
 */
export const STOP_PRESETS = ['Off', '−25%', '−50%'] as const;
export type StopPreset = (typeof STOP_PRESETS)[number];
export const DEFAULT_STOP: StopPreset = '−50%';

export function stopFraction(s: StopPreset): string {
  switch (s) {
    case '−25%':
      return '0.25';
    case '−50%':
      return '0.5';
    default:
      return '0';
  }
}
