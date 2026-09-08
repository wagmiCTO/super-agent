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

/** How often the screen re-reads account state, in milliseconds. */
export const STATE_POLL_MS = 2000;

/** Notional presets the player can pick, in collateral units. */
export const NOTIONAL_PRESETS = ['5', '10', '20', '50'] as const;

/** Leverage the Direction strategy trades at. MON allows at most 3x. */
export const DEFAULT_LEVERAGE = '2';

/** The market the Direction strategy opens on by default. */
export const DEFAULT_SYMBOL = 'MON';
