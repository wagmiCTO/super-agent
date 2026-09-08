/**
 * Passkey ceremonies on iOS and Android, through the platform WebAuthn APIs.
 *
 * Requires the app to be linked to the relying-party domain: the host in
 * EXPO_PUBLIC_RP_ID must serve /.well-known/apple-app-site-association and
 * /.well-known/assetlinks.json naming this app. Without that the platform
 * refuses the ceremony. See README.
 */
import { createPasskeyWithPrfOutput, getPasskeyPrfOutput } from '@category-labs/mera';
import { reactNativeWebAuthnClient } from '@category-labs/mera/react-native-webauthn-client';

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

export async function createPasskey(label: string): Promise<PasskeyResult> {
  const created = await createPasskeyWithPrfOutput({
    rp: { id: relyingPartyId(), name: APP_NAME },
    user: { name: label, displayName: label },
    webAuthnClient: reactNativeWebAuthnClient,
  });
  return { prfOutput: created.prfOutput, credential: { credentialId: created.credentialId } };
}

export async function signInWithPasskey(known?: StoredCredential): Promise<PasskeyResult> {
  const asserted = await getPasskeyPrfOutput({
    rpId: relyingPartyId(),
    webAuthnClient: reactNativeWebAuthnClient,
    ...(known === undefined ? {} : { credential: known }),
  });
  return { prfOutput: asserted.prfOutput, credential: { credentialId: asserted.credentialId } };
}
