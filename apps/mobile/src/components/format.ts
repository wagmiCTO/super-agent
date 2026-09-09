/** Display-only number helpers. Nothing here ever feeds a request. */

/** Trims trailing zeros for display. */
export function trim(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/\.?0+$/, '');
}

/** Product of two decimal strings, to 4 places. */
export function multiply(a: string, b: string): string {
  return (Number(a) * Number(b)).toFixed(4).replace(/\.?0+$/, '');
}

/** mm:ss, or h:mm:ss past an hour. */
export function clock(seconds: number): string {
  const left = Math.max(0, Math.floor(seconds));
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const sec = left % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
