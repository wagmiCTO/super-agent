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
 *
 * A deployed web build gets no default of its own: it calls its own origin and
 * the host rewrites `/v1/*` onward to the platform. That keeps the platform's
 * address out of the bundle — EXPO_PUBLIC_* is inlined at build time, so
 * baking it in means a rebuild every time the address moves — and it makes the
 * calls same-origin, so CORS stops being something to configure.
 */
const deployedWeb =
  typeof window !== 'undefined' &&
  Boolean(window.location?.origin) &&
  !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(window.location.origin);

export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ?? (deployedWeb ? window.location.origin : 'http://localhost:8080')
).replace(/\/$/, '');

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

/** What the product is called wherever the app says its own name. */
export const APP_NAME = 'Tap Trader';

/** How often the screen re-reads account state, in milliseconds. */
export const STATE_POLL_MS = 2000;

/** How often a strategy screen re-reads its signal, in milliseconds. */
export const SIGNAL_POLL_MS = 5000;

/** How often a strategy screen re-reads the market context card, in milliseconds. */
export const CONTEXT_POLL_MS = 5 * 60_000;

/**
 * How many rows a list asks for at a time — history and the boards.
 *
 * Small on purpose: the first screen arrives at once, and the next page is
 * already on its way by the time the reader gets to the bottom of it.
 */
export const PAGE_SIZE = 7;

/** How often the lobby re-reads the leaderboard, in milliseconds. */
export const LEADERBOARD_POLL_MS = 10_000;

/** Notional presets the trader can pick, in collateral units. */
export const NOTIONAL_PRESETS = ['5', '10', '20', '50'] as const;

/** Leverage the Direction strategy trades at. MON allows at most 3x. */
export const DEFAULT_LEVERAGE = '2';

/** The market a strategy screen opens on until another is chosen. */
export const DEFAULT_SYMBOL = 'MON';

/**
 * The markets a strategy screen offers, in this order, narrowed to what the
 * platform's policy allows. Perpl testnet lists BTC, ETH, SOL, MON, ZEC, LIT
 * and PUMP — no DOGE — so these four are the majors it has.
 */
export const SYMBOLS = ['MON', 'ETH', 'BTC', 'SOL'] as const;

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
 * The slot in the key family the passkey derives (ADR 0005, amended by
 * ADR 0007) that holds the wallet's one exchange key: slot 0, the slot the
 * Direction key had, so a wallet from before keeps its key. Part of the
 * derivation — never change.
 */
export const EXCHANGE_KEY_INDEX = 0;

/** The strategies' names as the lobby shows them, by id. */
export const STRATEGY_NAMES: Record<string, string> = { direction: 'Direction', 'ma-cross': 'MA Cross', rsi: 'RSI Bounce' };

/**
 * What the lobby's prize banner shows while no pool has paid this wallet
 * yet: the design's number, so the banner can be seen at all. `null` hides
 * the banner until a real prize exists.
 */
export const PLACEHOLDER_PRIZE_AUSD: number | null = 1.2;

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
