"use client";

import { useState } from "react";
import type { Address } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { musd } from "@/lib/contracts";
import { parseBtc, parseMusd } from "@/lib/format";
import { useTx, type WriteConfig } from "@/hooks/useTx";

const EXPLORER = "https://explorer.test.mezo.org/tx/";

/** Inline status line for a transaction: prompt, pending, error, or a success link. */
export function TxNote({ tx }: { tx: ReturnType<typeof useTx> }) {
  if (tx.status === "idle") return null;
  if (tx.status === "error") return <p className="text-sm text-danger">{tx.error}</p>;
  if (tx.status === "success")
    return (
      <p className="text-sm text-safe">
        Done.{" "}
        {tx.hash ? (
          <a className="underline" href={`${EXPLORER}${tx.hash}`} target="_blank" rel="noreferrer">
            View transaction
          </a>
        ) : null}
      </p>
    );
  return <p className="text-sm text-text-muted">{tx.status === "signing" ? "Confirm in your wallet…" : "Waiting for confirmation…"}</p>;
}

/** A single-amount action (add/withdraw/borrow/repay). `build` turns the parsed amount into a write. */
export function AmountAction({
  cta,
  unit,
  disabled,
  build,
  onDone,
}: {
  cta: string;
  unit: "BTC" | "MUSD";
  disabled?: boolean;
  build: (amount: bigint) => Promise<WriteConfig> | WriteConfig;
  onDone: () => void;
}) {
  const [raw, setRaw] = useState("");
  const tx = useTx(() => {
    setRaw("");
    onDone();
  });
  const parse = unit === "BTC" ? parseBtc : parseMusd;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={`Amount (${unit})`}
          inputMode="decimal"
          disabled={disabled || tx.busy}
        />
        <Button
          variant="outline"
          className="shrink-0"
          disabled={disabled || tx.busy || raw.trim() === ""}
          onClick={() => tx.run(() => build(parse(raw)))}
        >
          {tx.busy ? "…" : cta}
        </Button>
      </div>
      <TxNote tx={tx} />
    </div>
  );
}

/**
 * Two-step MUSD spend: approve the spender for `needed`, then run `build`. The button flips to the
 * action once the on-chain allowance covers `needed` (repay/close/repay-rescue all pull MUSD).
 */
export function ApproveAndAct({
  spender,
  needed,
  actionLabel,
  disabled,
  build,
  onDone,
}: {
  spender: Address;
  needed: bigint;
  actionLabel: string;
  disabled?: boolean;
  build: () => Promise<WriteConfig> | WriteConfig;
  onDone: () => void;
}) {
  const { address } = useAccount();
  const { data: allowance, refetch } = useReadContract({
    ...musd,
    functionName: "allowance",
    args: address ? [address, spender] : undefined,
    query: { enabled: address !== undefined },
  });
  const approve = useTx(() => void refetch());
  const act = useTx(onDone);
  const enough = needed > 0n && ((allowance as bigint | undefined) ?? 0n) >= needed;

  return (
    <div className="flex flex-col gap-2">
      {enough ? (
        <Button disabled={disabled || act.busy} onClick={() => act.run(build)}>
          {act.busy ? "…" : actionLabel}
        </Button>
      ) : (
        <Button
          disabled={disabled || approve.busy || needed === 0n}
          onClick={() => approve.run(() => ({ ...musd, functionName: "approve", args: [spender, needed] }))}
        >
          {approve.busy ? "Approving…" : "Approve MUSD"}
        </Button>
      )}
      <TxNote tx={enough ? act : approve} />
    </div>
  );
}

/** Safe parse for live allowance comparison: returns 0n on empty/invalid input instead of throwing. */
export function safeMusd(raw: string): bigint {
  try {
    return parseMusd(raw);
  } catch {
    return 0n;
  }
}
