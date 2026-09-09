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

export type ChartMessage = { type: 'chartType'; value: ChartType } | { type: 'trend'; value: Trend };

export type TVChartProps = {
  symbol: string;
  theme: 'light' | 'dark';
  /** The card's background, so the chart pane matches it exactly. */
  background: string;
  chartType: ChartType;
  trend: Trend;
  height: number;
};

/** Where the chart page lives, with the platform and the market in the query. */
export function chartPageUrl({ symbol, theme, background }: Pick<TVChartProps, 'symbol' | 'theme' | 'background'>): string {
  const q = new URLSearchParams({ api: API_URL, symbol, theme, bg: background });
  return `${WEB_URL}/tv.html?${q.toString()}`;
}
