/**
 * Passkey ceremonies on iOS and Android, through the platform WebAuthn APIs.
 *
 * Requires the app to be linked to the relying-party domain: the host in
 * EXPO_PUBLIC_RP_ID must serve /.well-known/apple-app-site-association and
 * /.well-known/assetlinks.json naming this app. Without that the platform
 * refuses the ceremony. See README.
 */
import { createPasskeyWithPrfOutput, getPasskeyPrfOutput, type WebAuthnClient } from '@category-labs/mera';

import type { StoredCredential } from './storage';

export const APP_NAME = 'TradeAgent';

export function relyingPartyId(): string {
  const rp = process.env.EXPO_PUBLIC_RP_ID;
  if (!rp) throw new Error('EXPO_PUBLIC_RP_ID is not set: passkeys on a device need a linked domain');
  return rp;
}

export type PasskeyResult = {
  prfOutput: Uint8Array;
  credential: StoredCredential;
};

/**
 * The platform WebAuthn client needs the react-native-passkey native module,
 * which exists only in a development build. Loading it lazily lets the rest
 * of the app run in Expo Go, where the passkey buttons explain what is missing
 * instead of the app failing to start.
 */
function nativeClient(): WebAuthnClient {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@category-labs/mera/react-native-webauthn-client') as { reactNativeWebAuthnClient: WebAuthnClient };
    return mod.reactNativeWebAuthnClient;
  } catch {
    throw new Error('Passkeys need a development build of the app (npx expo run:ios); Expo Go has no passkey module');
  }
}

export async function createPasskey(label: string): Promise<PasskeyResult> {
  const created = await createPasskeyWithPrfOutput({
    rp: { id: relyingPartyId(), name: APP_NAME },
    user: { name: label, displayName: label },
    webAuthnClient: nativeClient(),
  });
  return { prfOutput: created.prfOutput, credential: { credentialId: created.credentialId } };
}

export async function signInWithPasskey(known?: StoredCredential): Promise<PasskeyResult> {
  const asserted = await getPasskeyPrfOutput({
    rpId: relyingPartyId(),
    webAuthnClient: nativeClient(),
    ...(known === undefined ? {} : { credential: known }),
  });
  return { prfOutput: asserted.prfOutput, credential: { credentialId: asserted.credentialId } };
}
