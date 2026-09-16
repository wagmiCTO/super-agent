/**
 * The market a strategy screen trades, remembered per strategy.
 *
 * One exchange account holds one position per market whatever the
 * strategy (ADR 0005), so two strategies at once means two markets: the
 * screen offers the markets the platform allows, and a market that already
 * holds a position of another strategy is offered greyed out. The choice
 * is kept per strategy, so Direction on MON and MA Cross on ETH stay where
 * they were put.
 */
import { useCallback, useEffect, useState } from 'react';

import { DEFAULT_SYMBOL } from '@/config';
import { loadSymbols, saveSymbols } from '@/trading/symbol-store';

export function useSymbol(strategy: string): [string, (symbol: string) => void] {
  const [chosen, setChosen] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    loadSymbols().then((stored) => alive && setChosen(stored));
    return () => {
      alive = false;
    };
  }, []);

  const choose = useCallback(
    (symbol: string) => {
      setChosen((have) => {
        const next = { ...have, [strategy]: symbol.toUpperCase() };
        void saveSymbols(next);
        return next;
      });
    },
    [strategy],
  );

  return [chosen[strategy] ?? DEFAULT_SYMBOL, choose];
}
