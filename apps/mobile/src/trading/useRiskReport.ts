/**
 * The wallet's own risk report, polled — once for the whole app.
 *
 * It carries what this wallet did — today, this week, since it started,
 * per strategy and in total — so the screens that need those numbers ask
 * for them here rather than adding them up from whatever list they happen
 * to have loaded. History is paged; a total computed from the first page
 * would be a total of the first page.
 *
 * Every screen shows the dial, and the router keeps the screens under the
 * current one mounted, so a hook that polled per screen polled three or
 * four times over. One poll runs while anyone is listening; every listener
 * reads the same answer.
 */
import { useSyncExternalStore } from 'react';

import { api, type RiskReport } from '@/api/client';
import { LEADERBOARD_POLL_MS } from '@/config';

let report: RiskReport | null = null;
let listeners = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const subscribers = new Set<() => void>();

const read = () =>
  api
    .risk()
    .then((r) => {
      report = r;
      subscribers.forEach((fn) => fn());
    })
    .catch(() => undefined);

function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  if (listeners++ === 0) {
    void read();
    timer = setInterval(read, LEADERBOARD_POLL_MS);
  }
  return () => {
    subscribers.delete(fn);
    if (--listeners === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getReport = () => report;
const getNone = () => null;
const noop = () => () => undefined;

export function useRiskReport(ready: boolean): RiskReport | null {
  // The poll runs while a ready listener is mounted; a screen that is not
  // ready (no wallet yet) neither starts it nor reads it.
  return useSyncExternalStore(ready ? subscribe : noop, ready ? getReport : getNone, getNone);
}

/** Ask again now — after an order, when the dial must not wait for the poll. */
export function refreshRiskReport(): void {
  if (listeners > 0) void read();
}
