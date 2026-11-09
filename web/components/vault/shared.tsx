"use client";

import { useState } from "react";
import type { Address } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowUpRight, Check, Spinner } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { musd } from "@/lib/contracts";
import { parseBtc, parseMusd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useTx, type WriteConfig } from "@/hooks/useTx";

const EXPLORER = "https://explorer.test.mezo.org/tx/";

function TxLink({ hash }: { hash: string }) {
  return (
    <a
      className="inline-flex items-center gap-0.5 font-medium underline-offset-2 hover:underline"
      href={`${EXPLORER}${hash}`}
      target="_blank"
      rel="noreferrer"
    >
      View transaction
      <ArrowUpRight className="h-3 w-3" />
    </a>
  );
}

/** Inline status for a transaction: wallet prompt, pending, error, or confirmed with an explorer link. */
export function TxNote({ tx }: { tx: ReturnType<typeof useTx> }) {
  if (tx.status === "idle") return null;
  const tone =
    tx.status === "error"
      ? "border-danger/25 bg-danger/10 text-danger"
      : tx.status === "success"
        ? "border-safe/25 bg-safe/10 text-safe"
        : "border-border bg-bg-subtle text-text-muted";
  return (
    <div role="status" className={cn("flex items-start gap-2 rounded-sm border px-3 py-2 text-sm", tone)}>
      {tx.status === "error" ? (
        <AlertCircle className="mt-0.5" />
      ) : tx.status === "success" ? (
        <Check className="mt-0.5" />
      ) : (
        <Spinner className="mt-0.5" />
      )}
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {tx.status === "error"
          ? tx.error
          : tx.status === "success"
            ? "Confirmed"
            : tx.status === "signing"
              ? "Confirm in your wallet"
              : "Waiting for confirmation"}
        {tx.hash && (tx.status === "error" || tx.status === "success") ? <TxLink hash={tx.hash} /> : null}
      </span>
    </div>
  );
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
        <div className="relative flex-1">
          <Input
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            aria-label={`Amount in ${unit}`}
            disabled={disabled || tx.busy}
            className="pr-14"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-xs text-text-muted">
            {unit}
          </span>
        </div>
        <Button
          variant="outline"
          className="shrink-0"
          loading={tx.busy}
          disabled={disabled || raw.trim() === ""}
          onClick={() => tx.run(() => build(parse(raw)))}
        >
          {cta}
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
      {needed > 0n ? (
        <span className="text-xs text-text-muted">
          {enough ? "Step 2 of 2: confirm the transaction." : "Step 1 of 2: allow Lifeline to use your MUSD."}
        </span>
      ) : null}
      {enough ? (
        <Button loading={act.busy} disabled={disabled} onClick={() => act.run(build)}>
          {actionLabel}
        </Button>
      ) : (
        <Button
          loading={approve.busy}
          disabled={disabled || needed === 0n}
          onClick={() => approve.run(() => ({ ...musd, functionName: "approve", args: [spender, needed] }))}
        >
          Approve MUSD
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
