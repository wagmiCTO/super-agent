import type { ChartTheme } from './script';

/** Colors the chart takes from the app's theme. */
export function chartTheme(background: string, text: string, dark: boolean): ChartTheme {
  return {
    background,
    text,
    grid: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    up: '#16a34a',
    down: '#dc2626',
    fast: dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)',
    slow: '#2563eb',
  };
}
