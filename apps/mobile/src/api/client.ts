/**
 * Typed client for the platform API (../../api/openapi.yaml).
 *
 * Every amount is a decimal string on the wire and stays a string here. The
 * UI formats strings for display; nothing in the app does arithmetic on money.
 *
 * Errors are typed: a policy denial arrives as an ApiError whose `code` is one
 * of the engine's reasons, with the limit that was hit and the value that hit
 * it, so a screen can say "maximum is 50" instead of "request failed".
 */
import type { components, paths } from './schema';
import { API_URL } from '@/config';

export type Market = components['schemas']['Market'];
export type State = components['schemas']['State'];
export type Position = components['schemas']['Position'];
export type Order = components['schemas']['Order'];
export type OpenRequest = components['schemas']['OpenRequest'];
export type CloseRequest = components['schemas']['CloseRequest'];
export type ErrorBody = components['schemas']['Error'];
export type Side = components['schemas']['Side'];
export type MACrossSignal = components['schemas']['MACrossSignal'];
export type BoxSignal = components['schemas']['BoxSignal'];
export type Leaderboard = components['schemas']['Leaderboard'];
export type Board = components['schemas']['Board'];

/** Stable machine codes the server returns. Policy reasons come first. */
export type ErrorCode =
  | 'kill_switch'
  | 'symbol_not_allowed'
  | 'notional_too_large'
  | 'notional_too_small'
  | 'leverage_too_high'
  | 'daily_loss_limit_reached'
  | 'cooldown'
  | 'too_many_open_positions'
  | 'total_exposure_too_large'
  | 'malformed_request'
  | 'invalid_request'
  | 'venue_rejected'
  | 'unknown_market'
  | 'no_position'
  | 'enrollment_unavailable'
  | 'no_key'
  | 'no_credentials'
  | 'internal'
  | 'network';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly limit?: string;
  readonly actual?: string;
  readonly retryAfterSeconds?: number;

  constructor(status: number, body: Partial<ErrorBody> & { error?: string }, fallback: string) {
    super(body.message ?? fallback);
    this.name = 'ApiError';
    this.status = status;
    this.code = (body.error as ErrorCode) ?? 'internal';
    this.limit = body.limit;
    this.actual = body.actual;
    this.retryAfterSeconds = body.retry_after_seconds;
  }

  /** True for refusals the player can act on by waiting or changing the request. */
  get isPolicyDenial(): boolean {
    return this.status === 403;
  }
}

type Paths = paths;

/**
 * The wallet requests act for. While set, every call carries it in
 * X-Account-Address and the platform routes to that wallet's own exchange
 * key, limits and positions. Unset, requests use the platform's own account
 * — the pre-passkey path the trading tests exercise.
 *
 * This is routing, not authentication; signed requests from the wallet are
 * the next step, and until then the platform binds to loopback only.
 */
let accountAddress: string | null = null;

export function setAccountAddress(address: string | null): void {
  accountAddress = address;
}

export function currentAccountAddress(): string | null {
  return accountAddress;
}

export async function request<T>(path: keyof Paths | string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(accountAddress ? { 'X-Account-Address': accountAddress } : {}),
        // A localtunnel in front of the platform shows browsers a reminder
        // page unless asked not to; only relevant when testing a phone
        // against a laptop, and only sent to that host.
        ...(API_URL.endsWith('.loca.lt') ? { 'Bypass-Tunnel-Reminder': '1' } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    throw new ApiError(0, { error: 'network', message: `cannot reach ${API_URL}` }, String(e));
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok) {
    throw new ApiError(res.status, (body as Partial<ErrorBody>) ?? {}, `HTTP ${res.status}`);
  }
  return body as T;
}

export const api = {
  markets: () => request<Market[]>('/v1/markets'),
  state: () => request<State>('/v1/state'),
  open: (body: OpenRequest) =>
    request<Order>('/v1/orders/open', { method: 'POST', body: JSON.stringify(body) }),
  close: (body: CloseRequest) =>
    request<Order>('/v1/orders/close', { method: 'POST', body: JSON.stringify(body) }),
  maCross: (symbol: string) => request<MACrossSignal>(`/v1/signals/ma-cross?symbol=${encodeURIComponent(symbol)}`),
  box: (symbol: string) => request<BoxSignal>(`/v1/signals/box?symbol=${encodeURIComponent(symbol)}`),
  leaderboard: () => request<Leaderboard>('/v1/leaderboard'),
};

/**
 * A message a person can act on. Policy denials carry the numbers, so the
 * message is built from them rather than from the server's prose, which is
 * written for logs.
 */
export function describeError(e: unknown): string {
  if (!(e instanceof ApiError)) return String(e);
  switch (e.code) {
    case 'cooldown':
      return `Wait ${Math.ceil(e.retryAfterSeconds ?? 0)}s before opening again`;
    case 'notional_too_large':
      return `Maximum position is ${e.limit}`;
    case 'notional_too_small':
      return `Minimum position is ${e.limit}`;
    case 'leverage_too_high':
      return `Maximum leverage is ${e.limit}x`;
    case 'daily_loss_limit_reached':
      return `Daily loss limit of ${e.limit} reached — opening resumes tomorrow`;
    case 'too_many_open_positions':
      return `At most ${e.limit} positions at once`;
    case 'total_exposure_too_large':
      return `Total exposure would be ${e.actual}, limit is ${e.limit}`;
    case 'kill_switch':
      return `Trading is paused: ${e.message}`;
    case 'symbol_not_allowed':
      return 'This market is not enabled';
    case 'no_position':
      return 'Nothing to close';
    case 'no_key':
      return 'This wallet has no exchange key yet — connect the exchange first';
    case 'enrollment_unavailable':
      return 'The platform has no builder code configured';
    case 'venue_rejected':
      return `The exchange refused the order: ${e.message}`;
    case 'network':
      return e.message;
    default:
      return e.message;
  }
}
