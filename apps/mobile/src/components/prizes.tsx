/**
 * The wallet's prizes as the chain records them.
 *
 * The lobby asks only whether there is something to claim; the leaderboard
 * screen draws the claim itself, and the weeks the chain has settled.
 */
import { useCallback, useEffect, useState } from 'react';

import { fetchMyPrizes, type MyPrizes as PrizeList } from '@/exchange/prize';

/** The wallet's published prizes, re-read on demand after a claim. */
export function useMyPrizes(address: string | null): { mine: PrizeList | null; reload: () => void } {
  const [mine, setMine] = useState<PrizeList | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!address) return;
    let alive = true;
    fetchMyPrizes(address)
      .then((m) => alive && setMine(m))
      .catch(() => alive && setMine(null));
    return () => {
      alive = false;
    };
  }, [address, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { mine: address ? mine : null, reload };
}

/** What the wallet can still collect, summed; null when nothing is waiting. */
export function unclaimedTotal(mine: PrizeList | null): number | null {
  if (!mine) return null;
  const total = mine.prizes.filter((p) => !p.claimed).reduce((sum, p) => sum + Number(p.amount), 0);
  return total > 0 ? total : null;
}

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
