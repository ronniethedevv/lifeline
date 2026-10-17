"use client";

import { useCallback, useState } from "react";
import { type Abi, type Address, BaseError, type Hash } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";

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
 * Drives one contract write at a time: builds the request (may compute hints / parse input),
 * signs, waits for the receipt, and exposes status + a human-readable error for the UI.
 */
export function useTx(onSuccess?: () => void) {
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient();
  const [status, setStatus] = useState<TxStatus>("idle");
  const [error, setError] = useState<string>();
  const [hash, setHash] = useState<Hash>();

  const run = useCallback(
    async (build: () => Promise<WriteConfig> | WriteConfig) => {
      setError(undefined);
      setStatus("signing");
      try {
        const request = await build();
        const h = await writeContractAsync(request as unknown as WagmiWriteConfig);
        setHash(h);
        setStatus("pending");
        if (client) await client.waitForTransactionReceipt({ hash: h });
        setStatus("success");
        onSuccess?.();
      } catch (err) {
        setStatus("error");
        setError(err instanceof BaseError ? err.shortMessage : err instanceof Error ? err.message : String(err));
      }
    },
    [writeContractAsync, client, onSuccess],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setError(undefined);
    setHash(undefined);
  }, []);

  return { run, reset, status, error, hash, busy: status === "signing" || status === "pending" };
}
