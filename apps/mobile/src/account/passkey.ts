/**
 * Passkey ceremonies on the web. The relying party is the page's own host —
 * `localhost` during development is a secure context — so nothing here needs
 * a domain to be configured.
 *
 * The native build uses passkey.native.ts, which goes through the platform
 * WebAuthn APIs and needs the app linked to an HTTPS relying-party domain.
 */
import { createPasskeyWithPrfOutput, getPasskeyPrfOutput } from '@category-labs/mera';

import type { StoredCredential } from './storage';

export const APP_NAME = 'TradeAgent';

export function relyingPartyId(): string {
  return globalThis.location?.hostname ?? 'localhost';
}

export type PasskeyResult = {
  prfOutput: Uint8Array;
  credential: StoredCredential;
};

/** Creates a new passkey. Every call creates a new one — a new account. */
export async function createPasskey(label: string): Promise<PasskeyResult> {
  const created = await createPasskeyWithPrfOutput({
    rp: { id: relyingPartyId(), name: APP_NAME },
    user: { name: label, displayName: label },
  });
  return {
    prfOutput: created.prfOutput,
    credential: {
      credentialId: created.credentialId,
      ...(created.transports === undefined ? {} : { transports: created.transports }),
    },
  };
}

/**
 * Signs in with an existing passkey. With a stored credential the browser goes
 * straight to that passkey; without one it offers any it holds for this host.
 */
export async function signInWithPasskey(known?: StoredCredential): Promise<PasskeyResult> {
  const asserted = await getPasskeyPrfOutput({
    rpId: relyingPartyId(),
    ...(known === undefined ? {} : { credential: known }),
  });
  return {
    prfOutput: asserted.prfOutput,
    credential: {
      credentialId: asserted.credentialId,
      ...(known?.credentialId === asserted.credentialId && known.transports ? { transports: known.transports } : {}),
    },
  };
}
