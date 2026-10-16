import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mezoTestnet } from "viem/chains";

/** viem's built-in Mezo testnet (chain 31611, native BTC, 18 decimals); the RPC URL comes from config. */
export { mezoTestnet };

/** Mezo's public RPC drops connections and returns spurious errors: retry reads with backoff. */
const READ_RETRIES = 6;
const READ_RETRY_DELAY_MS = 1_000;
const REQUEST_TIMEOUT_MS = 30_000;

export function makePublicClient(rpcUrl: string) {
  return createPublicClient({
    chain: mezoTestnet,
    transport: http(rpcUrl, { retryCount: READ_RETRIES, retryDelay: READ_RETRY_DELAY_MS, timeout: REQUEST_TIMEOUT_MS }),
  });
}

/**
 * Sends are never auto-retried (a retry after a lost response could double-send): retryCount 0.
 */
export function makeWalletClient(rpcUrl: string, key: Hex) {
  return createWalletClient({
    account: privateKeyToAccount(key),
    chain: mezoTestnet,
    transport: http(rpcUrl, { retryCount: 0, timeout: REQUEST_TIMEOUT_MS }),
  });
}

export type MezoPublicClient = ReturnType<typeof makePublicClient>;
export type MezoWalletClient = ReturnType<typeof makeWalletClient>;
