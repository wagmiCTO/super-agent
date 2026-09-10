/**
 * Connecting a passkey wallet to the exchange.
 *
 * The platform generates the exchange API key and asks the venue for an
 * EIP-712 document binding it to this wallet and to the platform's builder
 * terms. The wallet — derived from the passkey, never leaving the device —
 * signs that document; that signature is the user's consent to the fee they
 * read in `statement`. The platform then proves it holds the key and the
 * venue issues it. From then on the platform can place orders for this
 * wallet, and can never withdraw.
 */
import { toViemAccount } from '@category-labs/mera/viem';
import type { TypedDataDomain } from 'viem';

import type { Wallet } from '@/account/derive';
import { ApiError, request } from '@/api/client';
import type { components } from '@/api/schema';

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
  payload: (address: string, label: string) =>
    request<EnrollPayload>('/v1/exchange/enroll/payload', {
      method: 'POST',
      body: JSON.stringify({ address, label }),
    }),
  enroll: (handle: string, signInSignature: string, signature: string) =>
    request<EnrolledKey>('/v1/exchange/enroll', {
      method: 'POST',
      body: JSON.stringify({ handle, sign_in_signature: signInSignature, signature }),
    }),
  key: (address: string) => request<EnrolledKey>(`/v1/exchange/key?address=${encodeURIComponent(address)}`),
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

/**
 * Runs both steps. The wallet makes two signatures, neither of which prompts
 * the user: the session key signs silently once the passkey has unlocked it.
 *
 * - the venue's sign-in message, as a personal message — this is the user
 *   accepting the venue's terms and, on first contact, becoming a profile;
 * - the enrollment document, as EIP-712 — consent to our builder fee.
 *
 * The venue's enroll endpoint refuses roughly two in five otherwise valid
 * submissions with a bare 400, deterministically for a given document
 * (measured 10 Sep 2026 on twenty fresh wallets; not the recovery byte, as
 * first thought — reported to the venue). Retrying the same body never
 * helps; a fresh payload — new API key, new timestamp — is an independent
 * draw, so the wallet signs a new one on each refusal. Silent, and five
 * draws leave under one percent of users without a key.
 */
export async function connectExchange(wallet: Wallet, label = 'TradeAgent'): Promise<EnrolledKey> {
  const account = toViemAccount(wallet.session);
  let last: unknown;
  for (let attempt = 0; attempt < MAX_ENROLL_ATTEMPTS; attempt++) {
    const payload = await exchangeApi.payload(wallet.address, label);
    const signature = await signEnrollment(wallet, payload.typed_data as unknown as TypedDataDocument);
    const signInSignature = await account.signMessage({ message: payload.sign_in_message });
    try {
      return await exchangeApi.enroll(payload.handle, signInSignature, signature);
    } catch (e) {
      // Only the venue's refusal of this particular document is worth a
      // fresh draw; anything else (network, our own 4xx) is reported as is.
      if (!(e instanceof ApiError && e.code === 'venue_rejected')) throw e;
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error('the exchange refused every enrollment attempt; try again');
}

/** Bound on fresh payloads per Connect: (2/5)^5 < 1% left without a key. */
const MAX_ENROLL_ATTEMPTS = 5;

/** Whether a key is already enrolled for the wallet; null when the platform has none. */
export async function enrolledKey(address: string): Promise<EnrolledKey | null> {
  try {
    return await exchangeApi.key(address);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}
