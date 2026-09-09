/**
 * Opening the wallet's exchange account on-chain.
 *
 * An enrolled API key lets the platform place orders for the wallet, but the
 * venue only trades for accounts that exist on its Exchange contract. Three
 * transactions, all sent by the wallet itself — the platform never holds a
 * key that could send them:
 *
 *   approve(exchange, amount)   on the collateral token
 *   createAccount(amount)       on the Exchange, amount ≥ the venue's minimum
 *   allowOrderForwarding(true)  on the Exchange — lets the exchange submit API
 *                               orders for this account, gas-less for the user
 *
 * The platform serves the coordinates (chain, contracts, minimum) from the
 * venue's live configuration; the app reads balances from the chain directly.
 */
import { toViemAccount } from '@category-labs/mera/viem';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatUnits,
  http,
  parseAbi,
  parseEther,
  type Address,
  type Chain,
  type Hex,
} from 'viem';

import type { Wallet } from '@/account/derive';
import { request } from '@/api/client';
import type { components } from '@/api/schema';

export type ExchangeNetwork = components['schemas']['ExchangeNetwork'];

export const exchangeAbi = parseAbi([
  'function createAccount(uint256 amountCNS) returns (uint256 accountId)',
  'function allowOrderForwarding(bool allow)',
]);

export const erc20Abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
]);

/**
 * Native token the wallet must hold for gas. Monad testnet prices gas at
 * ~100 gwei base; three transactions of well under 200k gas each fit in a
 * tenth of a MON with room to spare.
 */
export const GAS_RESERVE_MON = parseEther('0.1');

export const fetchExchangeNetwork = () => request<ExchangeNetwork>('/v1/exchange/network');

export function toChain(net: ExchangeNetwork): Chain {
  return defineChain({
    id: net.chain_id,
    name: `Monad ${net.network}`,
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: [net.rpc_url] } },
    blockExplorers: { default: { name: 'Explorer', url: net.explorer } },
  });
}

export type Funding = {
  /** Native balance, wei. */
  native: bigint;
  /** Collateral balance, raw token units. */
  collateral: bigint;
  /** Collateral the Exchange is already allowed to pull, raw token units. */
  allowance: bigint;
};

export async function readFunding(net: ExchangeNetwork, address: Address): Promise<Funding> {
  const client = createPublicClient({ chain: toChain(net), transport: http(net.rpc_url) });
  const token = net.collateral_token as Address;
  const exchange = net.exchange_address as Address;
  const [native, collateral, allowance] = await Promise.all([
    client.getBalance({ address }),
    client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [address] }),
    client.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [address, exchange] }),
  ]);
  return { native, collateral, allowance };
}

/** What the wallet still lacks before activation can run; both zero when funded. */
export function shortfall(net: ExchangeNetwork, f: Funding): { native: bigint; collateral: bigint } {
  const min = BigInt(net.min_account_open_raw);
  return {
    native: f.native >= GAS_RESERVE_MON ? 0n : GAS_RESERVE_MON - f.native,
    collateral: f.collateral >= min ? 0n : min - f.collateral,
  };
}

export const formatCollateral = (net: ExchangeNetwork, raw: bigint) => formatUnits(raw, net.collateral_decimals);
export const formatNative = (wei: bigint) => trimZeros(formatUnits(wei, 18), 4);

function trimZeros(s: string, maxDecimals: number): string {
  const [int, frac = ''] = s.split('.');
  const cut = frac.slice(0, maxDecimals).replace(/0+$/, '');
  return cut ? `${int}.${cut}` : int;
}

export type ActivationStep = 'approve' | 'create' | 'forward';

export type ActivationPlan = {
  /** Steps still to run, in order. */
  steps: ActivationStep[];
};

/**
 * Which transactions are still needed. A wallet whose account exists but has
 * not allowed forwarding only needs the last one; an allowance left over from
 * an earlier attempt skips the first.
 */
export function plan(net: ExchangeNetwork, f: Funding, status: 'no_exchange_account' | 'forwarding_disabled'): ActivationPlan {
  if (status === 'forwarding_disabled') return { steps: ['forward'] };
  const min = BigInt(net.min_account_open_raw);
  const steps: ActivationStep[] = [];
  if (f.allowance < min) steps.push('approve');
  steps.push('create', 'forward');
  return { steps };
}

/**
 * Runs the plan, one confirmed transaction after another. `onStep` fires as
 * each step starts so the screen can say what is happening; every step waits
 * for its receipt before the next one is sent, because createAccount must be
 * mined before allowOrderForwarding can find the account.
 */
export async function activate(
  wallet: Wallet,
  net: ExchangeNetwork,
  p: ActivationPlan,
  onStep: (step: ActivationStep, hash?: Hex) => void,
): Promise<void> {
  const chain = toChain(net);
  const account = toViemAccount(wallet.session);
  const transport = http(net.rpc_url);
  const pub = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });
  const exchange = net.exchange_address as Address;
  const token = net.collateral_token as Address;
  const amount = BigInt(net.min_account_open_raw);

  for (const step of p.steps) {
    onStep(step);
    let hash: Hex;
    switch (step) {
      case 'approve':
        hash = await walletClient.writeContract({
          address: token,
          abi: erc20Abi,
          functionName: 'approve',
          args: [exchange, amount],
        });
        break;
      case 'create':
        hash = await walletClient.writeContract({
          address: exchange,
          abi: exchangeAbi,
          functionName: 'createAccount',
          args: [amount],
        });
        break;
      case 'forward':
        hash = await walletClient.writeContract({
          address: exchange,
          abi: exchangeAbi,
          functionName: 'allowOrderForwarding',
          args: [true],
        });
        break;
    }
    onStep(step, hash);
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') {
      throw new Error(`${STEP_LABEL[step]} reverted (${hash})`);
    }
  }
}

export const STEP_LABEL: Record<ActivationStep, string> = {
  approve: 'Approving collateral',
  create: 'Creating exchange account',
  forward: 'Enabling API trading',
};
