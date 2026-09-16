/**
 * The wallet's own risk report, polled.
 *
 * It carries what this wallet did — today, this week, since it started,
 * per strategy and in total — so the screens that need those numbers ask
 * for them here rather than adding them up from whatever list they happen
 * to have loaded. History is paged; a total computed from the first page
 * would be a total of the first page.
 */
import { useEffect, useState } from 'react';

import { api, type RiskReport } from '@/api/client';
import { LEADERBOARD_POLL_MS } from '@/config';

export function useRiskReport(ready: boolean): RiskReport | null {
  const [report, setReport] = useState<RiskReport | null>(null);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const read = () =>
      api
        .risk()
        .then((r) => alive && setReport(r))
        .catch(() => undefined);
    // Deferred rather than called in the effect body: the first read is a
    // poll like every other, not a render-time state change.
    const first = setTimeout(read, 0);
    const id = setInterval(read, LEADERBOARD_POLL_MS);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [ready]);
  return ready ? report : null;
}
