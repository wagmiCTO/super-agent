/**
 * The chart page (public/tv.html) hosts TradingView's Charting Library and
 * a datafeed on the platform's candles. The app embeds it — an iframe on
 * web, a WebView on the phone — and talks to it with postMessage.
 *
 * The library is licensed and never enters the repository; the page loads
 * it from /static/charting_library/ on the site that serves the app. See
 * scripts/link-charting-library.mjs.
 */
import { API_URL, WEB_URL } from '@/config';

export type ChartType = 'candles' | 'line';
export type Trend = 'up' | 'down' | 'flat';

/** The bars the venue serves, as the library names them: minutes. */
export const INTERVALS = ['1', '5', '15', '30', '60'] as const;
export type Interval = (typeof INTERVALS)[number];
export const INTERVAL_LABELS: Record<Interval, string> = { '1': '1m', '5': '5m', '15': '15m', '30': '30m', '60': '1h' };

export type Box = { top: string; bottom: string };

/** A round trip to mark on the chart; an open one has no exit. */
export type ChartTrade = { side: 'long' | 'short'; size: string; entry_price: string; exit_price?: string; pnl?: string; opened_at: string; closed_at?: string };

/** The open position: one line at the entry with the live result. */
export type ChartPosition = { side: 'long' | 'short'; size: string; entry_price: string; unrealized_pnl: string };

/** What the page says back: the last close, and its move since the day opened, in percent. */
export type ChartTick = { price: string; change: number | null };

export type ChartMessage =
  | { type: 'chartType'; value: ChartType }
  | { type: 'interval'; value: Interval }
  | { type: 'trend'; value: Trend }
  | { type: 'box'; value: Box | null }
  | { type: 'trades'; value: ChartTrade[] }
  | { type: 'position'; value: ChartPosition | null };

/** The skin's colours, so the pane is drawn in the same ink as the screen around it. */
export type ChartColours = { background: string; up: string; down: string; accent: string; text: string; grid: string; line: string };

export type TVChartProps = {
  symbol: string;
  theme: 'light' | 'dark';
  colours: ChartColours;
  chartType: ChartType;
  interval: Interval;
  trend: Trend;
  /** Length of the one moving average drawn; 0 draws none. */
  ma?: number;
  /** An extra study in its own pane: the RSI for the counter-trend screen. */
  study?: 'rsi';
  box?: Box | null;
  trades?: ChartTrade[];
  position?: ChartPosition | null;
  /** The last price, whenever the page learns a new one. */
  onTick?: (tick: ChartTick) => void;
};

/** Where the chart page lives, with the platform, the market and the colours in the query. */
export function chartPageUrl({ symbol, theme, colours, ma, study }: Pick<TVChartProps, 'symbol' | 'theme' | 'colours' | 'ma' | 'study'>): string {
  const q = new URLSearchParams({
    api: API_URL,
    symbol,
    theme,
    bg: colours.background,
    up: colours.up,
    down: colours.down,
    accent: colours.accent,
    text: colours.text,
    grid: colours.grid,
    line: colours.line,
    ma: String(ma ?? 20),
    study: study ?? '',
  });
  return `${WEB_URL}/tv.html?${q.toString()}`;
}

/** Reads a tick out of whatever the page posted, or null when it is not one. */
export function tickFrom(data: unknown): ChartTick | null {
  const msg = typeof data === 'string' ? safeJson(data) : data;
  if (!msg || typeof msg !== 'object') return null;
  const m = msg as { type?: unknown; price?: unknown; change?: unknown };
  if (m.type !== 'price' || typeof m.price !== 'string') return null;
  return { price: m.price, change: typeof m.change === 'number' && Number.isFinite(m.change) ? m.change : null };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
