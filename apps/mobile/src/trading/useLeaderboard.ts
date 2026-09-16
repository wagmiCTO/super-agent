/**
 * The boards, polled: what each strategy made for its traders, who is up,
 * and the on-chain prize pool when one is configured. `period` is this week
 * or every trade on record; the prize block is this week's either way.
 */
import { useEffect, useState } from 'react';

import { api, type Leaderboard } from '@/api/client';
import { LEADERBOARD_POLL_MS } from '@/config';

export function useLeaderboard(period: 'week' | 'all' = 'week'): Leaderboard | null {
  const [lb, setLb] = useState<Leaderboard | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () =>
      api
        .leaderboard(period)
        .then((next) => alive && setLb(next))
        .catch(() => undefined);
    void read();
    const id = setInterval(read, LEADERBOARD_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [period]);
  return lb;
}
