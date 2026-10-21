"use client";

import { useEffect, useState } from "react";
import { useReadContract } from "wagmi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fuzzyPricer } from "@/lib/contracts";
import { bpsToPct, feeBps, pctToWad } from "@/lib/pricer";
import { MEZO_TESTNET_CHAIN_ID } from "@/lib/wallet";

function Slider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-text-muted">{label}</span>
        <span className="font-mono text-sm tabular-nums text-text">{value}%</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="h-2 w-full cursor-pointer accent-accent"
      />
    </div>
  );
}

/** Interactive view of the on-chain fuzzy pricer (ui_context.md page 6, T2.6). */
export function PricerExplorer() {
  const [icr, setIcr] = useState(130);
  const [size, setSize] = useState(20);
  const [tcr, setTcr] = useState(180);

  // Instant, from the local mirror of the committed table.
  const computed = feeBps(pctToWad(icr), pctToWad(size), pctToWad(tcr));

  // Debounce the on-chain verify read so sliding doesn't hammer the flaky RPC.
  const [debounced, setDebounced] = useState({ icr, size, tcr });
  useEffect(() => {
    const t = setTimeout(() => setDebounced({ icr, size, tcr }), 400);
    return () => clearTimeout(t);
  }, [icr, size, tcr]);

  const { data: onchainRaw, isFetching } = useReadContract({
    ...fuzzyPricer,
    functionName: "feeBps",
    args: [pctToWad(debounced.icr), pctToWad(debounced.size), pctToWad(debounced.tcr)],
    chainId: MEZO_TESTNET_CHAIN_ID,
  });
  const onchain = onchainRaw as bigint | undefined;
  const settled = debounced.icr === icr && debounced.size === size && debounced.tcr === tcr;

  const verifyLine =
    !settled || isFetching
      ? "verifying on-chain…"
      : onchain === undefined
        ? "on-chain read unavailable — retrying"
        : onchain === computed
          ? `on-chain: ${bpsToPct(onchain)} ✓ matches`
          : `on-chain: ${bpsToPct(onchain)}`;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Pricer</h1>
        <p className="max-w-xl text-sm text-text-muted">
          Every rescue&apos;s fee is set on-chain by a fuzzy-logic model committed at deployment — no oracle, no
          off-chain input. Move the sliders to see the fee it would charge.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rescue fee</CardTitle>
          <CardDescription>
            Fuzzy inference over loan health, rescue size and system health. Committed table: min 1% · max 10%.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col items-center gap-1 rounded-[var(--radius)] border border-border bg-surface-2 py-6">
            <span className="font-mono text-5xl font-semibold tabular-nums text-accent">{bpsToPct(computed)}</span>
            <span className="text-xs text-text-muted">of the repaid amount</span>
            <span className="mt-1 text-xs text-text-muted">{verifyLine}</span>
          </div>

          <div className="flex flex-col gap-5">
            <Slider label="Loan health (ICR)" value={icr} min={110} max={200} onChange={setIcr} />
            <Slider label="Rescue size (% of collateral)" value={size} min={0} max={50} onChange={setSize} />
            <Slider label="System health (TCR)" value={tcr} min={150} max={220} onChange={setTcr} />
          </div>

          <dl className="grid grid-cols-3 gap-4 border-t border-border pt-4 text-xs">
            <div>
              <dt className="text-text-muted">ICR thresholds</dt>
              <dd className="font-mono tabular-nums">110 · 125 · 150%</dd>
            </div>
            <div>
              <dt className="text-text-muted">Size thresholds</dt>
              <dd className="font-mono tabular-nums">5 · 20 · 40%</dd>
            </div>
            <div>
              <dt className="text-text-muted">TCR thresholds</dt>
              <dd className="font-mono tabular-nums">150 · 170 · 200%</dd>
            </div>
          </dl>
          <p className="text-xs text-text-muted">
            The 27-cell rule table and breakpoints are fixed in the contract and emitted on-chain (
            <span className="font-mono">PricerCommitted</span>). This page computes the fee locally and reads{" "}
            <span className="font-mono">feeBps</span> from the deployed pricer to confirm the two agree.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
