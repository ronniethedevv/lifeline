"use client";

import { useCallback, useState } from "react";
import {
  type Abi,
  type Address,
  BaseError,
  ContractFunctionExecutionError,
  type Hash,
  TransactionReceiptNotFoundError,
  WaitForTransactionReceiptTimeoutError,
} from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";

export type TxStatus = "idle" | "signing" | "pending" | "success" | "error";

/**
 * Builder-facing write request. Permissive by design: callers assemble it by spreading a generated
 * contract descriptor, which loses wagmi's payable/args discrimination. The ABIs are generated from
 * Foundry output, so the one cast to wagmi's strict type (below) is sound.
 */
export interface WriteConfig {
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
}

type WagmiWriteConfig = Parameters<ReturnType<typeof useWriteContract>["writeContractAsync"]>[0];

/**
 * Drives one contract write at a time: builds the request, simulates it (to surface reverts with
 * their reason before signing), signs, waits for the receipt, and exposes status + a human-readable
 * error for the UI. Tuned for Mezo's slow, flaky public RPC (architecture.md §3).
 */
export function useTx(onSuccess?: () => void) {
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient();
  const { address } = useAccount();
  const [status, setStatus] = useState<TxStatus>("idle");
  const [error, setError] = useState<string>();
  const [hash, setHash] = useState<Hash>();

  const run = useCallback(
    async (build: () => Promise<WriteConfig> | WriteConfig) => {
      setError(undefined);
      setStatus("signing");
      let sentHash: Hash | undefined;
      try {
        const request = await build();

        // Catch reverts (e.g. a sub-minimum borrow) with their reason BEFORE signing, via an
        // eth_call on the live node — Mezo's oracle precompile runs there, unlike a Forge sim.
        // Only a contract revert blocks the send; a transient RPC error falls through to the wallet.
        if (client && address) {
          try {
            await client.simulateContract({
              ...request,
              account: address,
            } as unknown as Parameters<typeof client.simulateContract>[0]);
          } catch (simErr) {
            if (simErr instanceof ContractFunctionExecutionError) throw simErr;
          }
        }

        const h = await writeContractAsync(request as unknown as WagmiWriteConfig);
        sentHash = h;
        setHash(h);
        setStatus("pending");

        if (client) {
          const receipt = await client.waitForTransactionReceipt({
            hash: h,
            timeout: 180_000, // Mezo's public RPC is slow and drops connections; wait generously
            pollingInterval: 4_000,
            retryCount: 12,
          });
          if (receipt.status === "reverted") {
            setStatus("error");
            setError("Transaction reverted on-chain — check the explorer for the reason.");
            return;
          }
        }

        setStatus("success");
        onSuccess?.();
      } catch (err) {
        setStatus("error");
        if (
          sentHash !== undefined &&
          (err instanceof TransactionReceiptNotFoundError || err instanceof WaitForTransactionReceiptTimeoutError)
        ) {
          setError(
            "Submitted, but Mezo's RPC is slow to confirm. Your transaction may still go through — check the explorer.",
          );
        } else {
          setError(err instanceof BaseError ? err.shortMessage : err instanceof Error ? err.message : String(err));
        }
      }
    },
    [writeContractAsync, client, address, onSuccess],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setError(undefined);
    setHash(undefined);
  }, []);

  return { run, reset, status, error, hash, busy: status === "signing" || status === "pending" };
}
