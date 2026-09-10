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
import { sha256 } from '@noble/hashes/sha2.js';

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
export type RSISignal = components['schemas']['RSISignal'];
export type Trade = components['schemas']['Trade'];
export type Leaderboard = components['schemas']['Leaderboard'];
export type Board = components['schemas']['Board'];
export type MarketContext = components['schemas']['MarketContext'];
export type DepositOptions = components['schemas']['DepositOptions'];
export type DepositQuote = components['schemas']['DepositQuote'];
export type DepositStatus = components['schemas']['DepositStatus'];
export type PrizeHistory = components['schemas']['PrizeHistory'];
export type RiskReport = components['schemas']['RiskReport'];

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
  | 'unauthenticated'
  | 'context_unavailable'
  | 'deposit_unavailable'
  | 'history_unavailable'
  | 'own_account_disabled'
  | 'partner_error'
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
 * X-Account-Address and, with a strategy, X-Strategy: the platform routes
 * to that wallet's key for the strategy, its limits and positions. Unset,
 * requests use the platform's own account — the pre-passkey path the
 * trading tests exercise.
 *
 * With a signer set, every such request is also signed: X-Auth-Key,
 * X-Auth-Time and X-Auth-Signature over the method, path, time and body
 * hash, by the request-signing key the passkey derives. The platform
 * refuses unsigned requests for a wallet once its key is registered.
 */
let accountAddress: string | null = null;

export type RequestSigner = {
  /** Ed25519 public key, hex. */
  publicKey: string;
  sign: (message: Uint8Array) => Promise<Uint8Array>;
};

let signer: RequestSigner | null = null;

export function setAccountAddress(address: string | null): void {
  accountAddress = address;
}

export function currentAccountAddress(): string | null {
  return accountAddress;
}

export function setRequestSigner(s: RequestSigner | null): void {
  signer = s;
}

/** Per-call options beyond fetch's: which strategy the request is for. */
export type RequestOptions = { strategy?: string };

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** What the request key signs: the platform builds the same string. */
export function signingString(method: string, path: string, time: string, body: string): Uint8Array {
  return new TextEncoder().encode(`${method}\n${path}\n${time}\n${hex(sha256(new TextEncoder().encode(body)))}`);
}

async function authHeaders(method: string, path: string, body: string): Promise<Record<string, string>> {
  if (!accountAddress || !signer) return {};
  const time = String(Math.floor(Date.now() / 1000));
  const signature = await signer.sign(signingString(method, path, time, body));
  return { 'X-Auth-Key': signer.publicKey, 'X-Auth-Time': time, 'X-Auth-Signature': hex(signature) };
}

export async function request<T>(path: keyof Paths | string, init?: RequestInit, opts?: RequestOptions): Promise<T> {
  let res: Response;
  const method = (init?.method ?? 'GET').toUpperCase();
  const payload = typeof init?.body === 'string' ? init.body : '';
  const signed = await authHeaders(method, path, payload);
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(accountAddress ? { 'X-Account-Address': accountAddress } : {}),
        ...(accountAddress && opts?.strategy ? { 'X-Strategy': opts.strategy } : {}),
        ...signed,
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
  state: (strategy: string) => request<State>('/v1/state', undefined, { strategy }),
  open: (body: OpenRequest) =>
    request<Order>('/v1/orders/open', { method: 'POST', body: JSON.stringify(body) }, { strategy: body.strategy }),
  close: (body: CloseRequest) =>
    request<Order>('/v1/orders/close', { method: 'POST', body: JSON.stringify(body) }, { strategy: body.strategy }),
  maCross: (symbol: string) => request<MACrossSignal>(`/v1/signals/ma-cross?symbol=${encodeURIComponent(symbol)}`),
  trades: (symbol: string, strategy: string) =>
    request<Trade[]>(`/v1/trades?symbol=${encodeURIComponent(symbol)}&strategy=${encodeURIComponent(strategy)}&limit=50`, undefined, { strategy }),
  rsi: (symbol: string) => request<RSISignal>(`/v1/signals/rsi?symbol=${encodeURIComponent(symbol)}`),
  leaderboard: () => request<Leaderboard>('/v1/leaderboard'),
  context: (symbol: string) => request<MarketContext>(`/v1/context?symbol=${encodeURIComponent(symbol)}`),
  depositOptions: () => request<DepositOptions>('/v1/deposit/options'),
  depositQuote: (body: { origin_asset: string; amount: string; dry?: boolean }) =>
    request<DepositQuote>('/v1/deposit/quote', { method: 'POST', body: JSON.stringify(body) }),
  prizeHistory: () => request<PrizeHistory>('/v1/prizes/history?limit=12'),
  risk: () => request<RiskReport>('/v1/risk'),
  closeAll: () =>
    request<{ closed: number; results: { strategy: string; symbol: string; closed: boolean; error?: string; pnl?: string }[] }>('/v1/risk/close-all', {
      method: 'POST',
      body: '{}',
    }),
  depositStatus: (depositAddress: string) =>
    request<DepositStatus>(`/v1/deposit/status?deposit_address=${encodeURIComponent(depositAddress)}`),
};

// The browser tests read the wallet's state through the app, since only the
// app holds the request-signing key. Read-only, and nothing a page could
// not already see on screen.
if (typeof window !== 'undefined') {
  (window as unknown as { __tradeagent?: unknown }).__tradeagent = { state: (strategy: string) => api.state(strategy) };
}

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
    case 'partner_error':
      return e.message;
    case 'own_account_disabled':
      return 'Sign in with your passkey first';
    case 'no_key':
      return 'Enable this strategy first — it trades with its own key';
    case 'unauthenticated':
      return 'Sign in again — the platform could not verify this request';
    case 'kill_switch':
      return `Trading is paused: ${e.message}`;
    case 'symbol_not_allowed':
      return 'This market is not enabled';
    case 'no_position':
      return 'Nothing to close';
    case 'partner_error':
      return e.message;
    case 'own_account_disabled':
      return 'Sign in with your passkey first';
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
