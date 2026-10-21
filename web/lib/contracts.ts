import type { Address } from "viem";
import { addresses } from "./generated/addresses";
import {
  borrowerOperationsAbi,
  erc20Abi,
  fuzzyFeePricerAbi,
  hintHelpersAbi,
  positionVaultAbi,
  priceFeedAbi,
  rescueMarketAbi,
  sortedTrovesAbi,
  troveManagerAbi,
  vaultFactoryAbi,
} from "./generated/abis";

export { addresses, CHAIN_ID } from "./generated/addresses";

/** Static contract descriptors (address + ABI) for wagmi read/write calls. */
export const factory = { address: addresses.vaultFactory, abi: vaultFactoryAbi } as const;
export const market = { address: addresses.rescueMarket, abi: rescueMarketAbi } as const;
export const troveManager = { address: addresses.troveManager, abi: troveManagerAbi } as const;
export const borrowerOperations = { address: addresses.borrowerOperations, abi: borrowerOperationsAbi } as const;
export const priceFeed = { address: addresses.priceFeed, abi: priceFeedAbi } as const;
export const hintHelpers = { address: addresses.hintHelpers, abi: hintHelpersAbi } as const;
export const sortedTroves = { address: addresses.sortedTroves, abi: sortedTrovesAbi } as const;
export const musd = { address: addresses.musd, abi: erc20Abi } as const;
export const fuzzyPricer = { address: addresses.fuzzyFeePricer, abi: fuzzyFeePricerAbi } as const;

/** A specific vault instance (one trove per vault). */
export function vault(address: Address) {
  return { address, abi: positionVaultAbi } as const;
}
