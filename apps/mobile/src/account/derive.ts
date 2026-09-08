/**
 * From 32 bytes of passkey PRF output to accounts.
 *
 * One passkey, many keys:
 *
 * - The **wallet** is the EVM account at BIP-44 index 0. It is the owner of
 *   the exchange account, signs the enrollment of API keys, and is the key a
 *   standard wallet app would derive from the same recovery phrase.
 * - A **strategy key** is an Ed25519 key derived per strategy. Perpl API keys
 *   are Ed25519 pairs, so each strategy gets its own API key, enrolled by the
 *   wallet with our builder code and its own fee ceiling, and run under its
 *   own policy limits on the server. The wallet never leaves the device; a
 *   strategy key can never withdraw — the venue forbids it for any API key.
 *
 * Changing either mapping changes every derived address; treat them as fixed.
 */
import {
  createEd25519SigningSession,
  createSecp256k1SigningSession,
  getEvmAddress,
  type Ed25519SigningSession,
  type EvmAddress,
  type Secp256k1SigningSession,
} from '@category-labs/mera';
import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { HDKey } from '@scure/bip32';
import { entropyToMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

const PRF_OUTPUT_LENGTH = 32;

/** BIP-44 Ethereum path; index 0 is the wallet, as MetaMask would derive it. */
const evmPath = (index: number) => `m/44'/60'/0'/0/${index}`;

/** Domain separator for strategy keys. Part of the derivation; never change. */
const STRATEGY_KEY_DOMAIN = new TextEncoder().encode('tradeagent/strategy-key/v1');

/**
 * The PRF output is used as 256 bits of BIP-39 entropy, so the same phrase
 * imported into any standard wallet reproduces the same wallet address.
 */
export function prfOutputToSeed(prfOutput: Uint8Array): Uint8Array {
  if (prfOutput.length !== PRF_OUTPUT_LENGTH) {
    throw new Error(`PRF output must be ${PRF_OUTPUT_LENGTH} bytes`);
  }
  return mnemonicToSeedSync(entropyToMnemonic(prfOutput, wordlist));
}

/** The recovery phrase for the wallet, shown only on explicit request. */
export function prfOutputToMnemonic(prfOutput: Uint8Array): string {
  return entropyToMnemonic(prfOutput, wordlist);
}

export type Wallet = {
  address: EvmAddress;
  session: Secp256k1SigningSession;
};

/** The wallet: EVM account 0. The caller owns the session and must end it. */
export function deriveWallet(seed: Uint8Array): Wallet {
  const node = HDKey.fromMasterSeed(seed).derive(evmPath(0));
  if (!node.privateKey) throw new Error('BIP-32 derivation produced no private key');
  const session = createSecp256k1SigningSession({ privateKey: node.privateKey });
  return { address: getEvmAddress(session.publicKey), session };
}

export type StrategyKey = {
  index: number;
  publicKey: Uint8Array;
  session: Ed25519SigningSession;
};

/**
 * An Ed25519 key for strategy `index`, to be enrolled as that strategy's
 * exchange API key. HMAC-SHA512 over a fixed domain and the index, keyed by
 * the seed: independent of the wallet path, so a strategy key reveals nothing
 * about the wallet and vice versa.
 */
export function deriveStrategyKey(seed: Uint8Array, index: number): StrategyKey {
  if (!Number.isInteger(index) || index < 0) throw new Error('strategy index must be a non-negative integer');
  const data = new Uint8Array(STRATEGY_KEY_DOMAIN.length + 4);
  data.set(STRATEGY_KEY_DOMAIN, 0);
  new DataView(data.buffer).setUint32(STRATEGY_KEY_DOMAIN.length, index, false);
  const privateKey = hmac(sha512, seed, data).slice(0, 32);
  const session = createEd25519SigningSession({ privateKey });
  return { index, publicKey: session.publicKey, session };
}
