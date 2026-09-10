/**
 * Connecting a passkey wallet to the exchange, one strategy at a time.
 *
 * Each strategy trades with its own exchange API key, derived on the device
 * from the passkey (see account/derive.ts). Enabling a strategy enrolls that
 * key: the platform asks the venue for an EIP-712 document binding the key
 * to this wallet and to the platform's builder terms; the wallet — never
 * leaving the device — signs it, and that signature is the user's consent
 * to the fee they read in `statement`. The key itself goes to the platform
 * with the enrollment, because the exit is the platform's job (it closes
 * positions on their horizon while the phone is in a pocket); it can never
 * withdraw, and revoking it on the venue's key page stops one strategy.
 *
 * The request-signing key is the other half: registered once with the
 * wallet's signature, it signs every request the app makes for the wallet.
 */
import { toViemAccount } from '@category-labs/mera/viem';
import type { TypedDataDomain } from 'viem';

import type { KeyFamily, StrategyKey, Wallet } from '@/account/derive';
import { toHex } from '@/account/hex';
import { ApiError, request } from '@/api/client';
import type { components } from '@/api/schema';
import { STRATEGY_KEY_INDEX } from '@/config';

export type EnrollPayload = components['schemas']['EnrollPayload'];
export type EnrolledKey = components['schemas']['EnrolledKey'];

/** The document as the venue sends it; only the parts the signer needs. */
type TypedDataDocument = {
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  domain: Record<string, unknown>;
  message: Record<string, unknown>;
};

export const exchangeApi = {
  payload: (address: string, strategy: string, publicKey: string) =>
    request<EnrollPayload>('/v1/exchange/enroll/payload', {
      method: 'POST',
      body: JSON.stringify({ address, strategy, public_key: publicKey }),
    }),
  enroll: (handle: string, signInSignature: string, signature: string, privateKey: string) =>
    request<EnrolledKey>('/v1/exchange/enroll', {
      method: 'POST',
      body: JSON.stringify({ handle, sign_in_signature: signInSignature, signature, private_key: privateKey }),
    }),
  key: (address: string, strategy: string) =>
    request<EnrolledKey>(`/v1/exchange/key?address=${encodeURIComponent(address)}&strategy=${encodeURIComponent(strategy)}`),
  keys: (address: string) => request<EnrolledKey[]>(`/v1/exchange/keys?address=${encodeURIComponent(address)}`),
  registerAuthKey: (address: string, publicKey: string, issuedAt: string, signature: string) =>
    request<{ address: string; public_key: string }>('/v1/auth/keys', {
      method: 'POST',
      body: JSON.stringify({ address, public_key: publicKey, issued_at: issuedAt, signature }),
    }),
};

/**
 * Signs the venue's EIP-712 document with the wallet.
 *
 * viem infers the domain type from the JavaScript types of the domain values.
 * The venue sends chainId as a hex string; handed that, viem silently drops
 * chainId from the domain and produces a digest the venue rejects. So chainId
 * is converted to a bigint here, and EIP712Domain is removed from `types`
 * because viem supplies its own.
 */
export async function signEnrollment(wallet: Wallet, doc: TypedDataDocument): Promise<`0x${string}`> {
  const { EIP712Domain: _ignored, ...types } = doc.types;
  const domain = { ...doc.domain } as Record<string, unknown>;
  if (typeof domain.chainId === 'string' || typeof domain.chainId === 'number') {
    domain.chainId = BigInt(domain.chainId);
  }
  const account = toViemAccount(wallet.session);
  return account.signTypedData({
    domain: domain as TypedDataDomain,
    types,
    primaryType: doc.primaryType,
    message: doc.message,
  });
}

/** The strategy key for a strategy id, from the family. */
export function strategyKeyFor(keys: KeyFamily, strategy: string): StrategyKey {
  const index = STRATEGY_KEY_INDEX[strategy];
  if (index === undefined) throw new Error(`no key index for strategy ${strategy}`);
  return keys.strategy(index);
}

/**
 * Enables a strategy: enrolls its derived key. The wallet makes two
 * signatures, neither of which prompts the user — the session key signs
 * silently once the passkey has unlocked it:
 *
 * - the venue's sign-in message, as a personal message — this is the user
 *   accepting the venue's terms and, on first contact, becoming a profile;
 * - the enrollment document, as EIP-712 — consent to our builder fee.
 *
 * The venue's enroll endpoint refuses roughly two in five otherwise valid
 * submissions with a bare 400, deterministically for a given document
 * (measured 10 Sep 2026 on twenty fresh wallets; not the recovery byte, as
 * first thought — reported to the venue). Retrying the same body never
 * helps; a fresh payload — new timestamp — is an independent draw, so the
 * wallet signs a new one on each refusal. Silent, and five draws leave
 * under one percent of users without a key.
 */
export async function enableStrategy(keys: KeyFamily, strategy: string): Promise<EnrolledKey> {
  const wallet = keys.wallet;
  const key = strategyKeyFor(keys, strategy);
  const account = toViemAccount(wallet.session);
  let last: unknown;
  for (let attempt = 0; attempt < MAX_ENROLL_ATTEMPTS; attempt++) {
    const payload = await exchangeApi.payload(wallet.address, strategy, toHex(key.publicKey));
    const signature = await signEnrollment(wallet, payload.typed_data as unknown as TypedDataDocument);
    const signInSignature = await account.signMessage({ message: payload.sign_in_message });
    try {
      return await exchangeApi.enroll(payload.handle, signInSignature, signature, toHex(key.privateKey));
    } catch (e) {
      // Only the venue's refusal of this particular document is worth a
      // fresh draw; anything else (network, our own 4xx) is reported as is.
      if (!(e instanceof ApiError && e.code === 'venue_rejected')) throw e;
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error('the exchange refused every enrollment attempt; try again');
}

/** Bound on fresh payloads per attempt: (2/5)^5 < 1% left without a key. */
const MAX_ENROLL_ATTEMPTS = 5;

/** The key enrolled for a strategy; null when the platform has none. */
export async function strategyKey(address: string, strategy: string): Promise<EnrolledKey | null> {
  try {
    return await exchangeApi.key(address, strategy);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** Every key the platform holds for a wallet: which strategies are enabled. */
export function enrolledKeys(address: string): Promise<EnrolledKey[]> {
  return exchangeApi.keys(address);
}

/**
 * The text the wallet signs to register the request-signing key. The
 * platform builds the same text; `issuedAt` is RFC 3339 at seconds.
 */
export function registrationMessage(address: string, publicKey: Uint8Array, issuedAt: string): string {
  return `TradeAgent request-signing key\nWallet: ${address.toLowerCase()}\nKey: ${toHex(publicKey)}\nIssued: ${issuedAt}`;
}

/** Registers the family's request-signing key with the platform. Idempotent. */
export async function registerAuthKey(keys: KeyFamily): Promise<void> {
  const issuedAt = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace('.000Z', 'Z');
  const account = toViemAccount(keys.wallet.session);
  const signature = await account.signMessage({ message: registrationMessage(keys.wallet.address, keys.auth.publicKey, issuedAt) });
  await exchangeApi.registerAuthKey(keys.wallet.address, toHex(keys.auth.publicKey), issuedAt, signature);
}
