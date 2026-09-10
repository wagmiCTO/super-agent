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

export type Box = { top: string; bottom: string };

/** A round trip to mark on the chart; an open one has no exit. */
export type ChartTrade = { side: 'long' | 'short'; size: string; entry_price: string; exit_price?: string; pnl?: string; opened_at: string; closed_at?: string };

/** The open position: one line at the entry with the live result. */
export type ChartPosition = { side: 'long' | 'short'; size: string; entry_price: string; unrealized_pnl: string };

export type ChartMessage =
  | { type: 'chartType'; value: ChartType }
  | { type: 'trend'; value: Trend }
  | { type: 'box'; value: Box | null }
  | { type: 'trades'; value: ChartTrade[] }
  | { type: 'position'; value: ChartPosition | null };

export type TVChartProps = {
  symbol: string;
  theme: 'light' | 'dark';
  /** The card's background, so the chart pane matches it exactly. */
  background: string;
  chartType: ChartType;
  trend: Trend;
  /** Length of the one moving average drawn; 0 draws none. */
  ma?: number;
  box?: Box | null;
  trades?: ChartTrade[];
  position?: ChartPosition | null;
  height: number;
};

/** Where the chart page lives, with the platform and the market in the query. */
export function chartPageUrl({ symbol, theme, background, ma }: Pick<TVChartProps, 'symbol' | 'theme' | 'background' | 'ma'>): string {
  const q = new URLSearchParams({ api: API_URL, symbol, theme, bg: background, ma: String(ma ?? 20) });
  return `${WEB_URL}/tv.html?${q.toString()}`;
}
