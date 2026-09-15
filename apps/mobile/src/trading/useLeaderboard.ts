/**
 * This week's boards, polled: what each strategy made for its players, who
 * is up, and the on-chain prize pool when one is configured.
 */
import { useEffect, useState } from 'react';

import { api, type Leaderboard } from '@/api/client';
import { LEADERBOARD_POLL_MS } from '@/config';

export function useLeaderboard(): Leaderboard | null {
  const [lb, setLb] = useState<Leaderboard | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () =>
      api
        .leaderboard()
        .then((next) => alive && setLb(next))
        .catch(() => undefined);
    void read();
    const id = setInterval(read, LEADERBOARD_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return lb;
}
