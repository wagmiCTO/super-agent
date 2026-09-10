/**
 * Claiming a weekly prize. The winners are published on the StrategyPrizePool
 * contract; each winner takes their own share with their wallet — the
 * platform never holds the payout.
 */
import { toViemAccount } from '@category-labs/mera/viem';
import { createPublicClient, createWalletClient, http, keccak256, parseAbi, stringToBytes, type Address, type Hex } from 'viem';

import type { Wallet } from '@/account/derive';
import { request } from '@/api/client';
import type { components } from '@/api/schema';
import { fetchExchangeNetwork, toChain } from './activate';

export type PrizeWinner = components['schemas']['PrizeWinner'];

export const prizeAbi = parseAbi(['function claim(uint64 week, bytes32 strategy)']);

export type MyPrizes = { contract: string; prizes: PrizeWinner[]; weeks: number[] };

export const fetchMyPrizes = (address: string) => request<MyPrizes>(`/v1/prizes?address=${encodeURIComponent(address)}`);

/** The strategy's on-chain key: keccak256 of its id, as the platform writes it. */
export const strategyKey = (id: string): Hex => keccak256(stringToBytes(id));

/** Sends claim(week, strategy) from the wallet and waits for it to be mined. */
export async function claimPrize(wallet: Wallet, contract: string, week: number, strategyId: string): Promise<Hex> {
  const net = await fetchExchangeNetwork();
  const chain = toChain(net);
  const transport = http(net.rpc_url);
  const walletClient = createWalletClient({ account: toViemAccount(wallet.session), chain, transport });
  const hash = await walletClient.writeContract({
    address: contract as Address,
    abi: prizeAbi,
    functionName: 'claim',
    args: [BigInt(week), strategyKey(strategyId)],
  });
  const receipt = await createPublicClient({ chain, transport }).waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`claim reverted (${hash})`);
  return hash;
}
