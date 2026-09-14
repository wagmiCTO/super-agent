/**
 * How long is left, ticking.
 *
 * A horizon and a signal window are both deadlines the user is watching, and
 * a deadline that only updates when something else re-renders reads as
 * frozen. Null until there is something to count to, so a screen with no
 * deadline pays for no timer.
 */

import { useEffect, useState } from 'react';

import { clock } from '@/components/format';

export function useCountdown(until: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  if (!until) return null;
  return clock((new Date(until).getTime() - now) / 1000);
}
