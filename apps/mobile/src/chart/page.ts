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
/** The band around a price where a trade cannot beat the round-trip fee. */
export type DeadZone = { price: string; bps: number };

export type ChartMessage =
  | { type: 'chartType'; value: ChartType }
  | { type: 'trend'; value: Trend }
  | { type: 'box'; value: Box | null }
  | { type: 'deadZone'; value: DeadZone | null };

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
  deadZone?: DeadZone | null;
  height: number;
};

/** Where the chart page lives, with the platform and the market in the query. */
export function chartPageUrl({ symbol, theme, background, ma }: Pick<TVChartProps, 'symbol' | 'theme' | 'background' | 'ma'>): string {
  const q = new URLSearchParams({ api: API_URL, symbol, theme, bg: background, ma: String(ma ?? 20) });
  return `${WEB_URL}/tv.html?${q.toString()}`;
}
