/**
 * Activation state for the unlocked wallet: what the chain says it holds,
 * what it still needs, and the action that sends the transactions.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address, Hex } from 'viem';

import type { Wallet } from '@/account/derive';
import { describeError } from '@/api/client';
import {
  activate,
  fetchExchangeNetwork,
  plan,
  readFunding,
  shortfall,
  type ActivationStep,
  type ExchangeNetwork,
  type Funding,
} from './activate';

export type PendingStatus = 'no_exchange_account' | 'forwarding_disabled';

export type Progress = { step: ActivationStep; hash?: Hex } | null;

/** How often balances are re-read while the wallet waits for funds. */
const FUNDING_POLL_MS = 5000;

export function useActivation(wallet: Wallet | null, status: PendingStatus | null) {
  const [network, setNetwork] = useState<ExchangeNetwork | null>(null);
  const [funding, setFunding] = useState<Funding | null>(null);
  const [progress, setProgress] = useState<Progress>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = Boolean(wallet && status);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetchExchangeNetwork()
      .then((n) => !cancelled && setNetwork(n))
      .catch((e) => !cancelled && setError(describeError(e)));
    return () => {
      cancelled = true;
    };
  }, [active]);

  const refresh = useCallback(async () => {
    if (!wallet || !network) return;
    try {
      const f = await readFunding(network, wallet.address as Address);
      setFunding(f);
    } catch (e) {
      setError(describeError(e));
    }
  }, [wallet, network]);

  useEffect(() => {
    if (!active || !network) return;
    void refresh();
    const id = setInterval(() => {
      // Do not race the activation's own transactions with balance reads.
      if (!busyRef.current) void refresh();
    }, FUNDING_POLL_MS);
    return () => clearInterval(id);
  }, [active, network, refresh]);

  const short = network && funding ? shortfall(network, funding) : null;
  const funded = short !== null && short.native === 0n && (status === 'forwarding_disabled' || short.collateral === 0n);

  const run = useCallback(async () => {
    if (!wallet || !network || !funding || !status) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await activate(wallet, network, plan(network, funding, status), (step, hash) => setProgress({ step, hash }));
      setProgress(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : describeError(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [wallet, network, funding, status]);

  return { network, funding, shortfall: short, funded, progress, busy, error, activate: run, refresh };
}
