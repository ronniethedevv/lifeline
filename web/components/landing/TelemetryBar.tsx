"use client";

import type { ReactNode } from "react";
import { useReadContract } from "wagmi";
import { LoadingValue } from "@/components/ui/skeleton";
import { market, priceFeed } from "@/lib/contracts";
import { formatMusd } from "@/lib/format";
import { MEZO_TESTNET_CHAIN_ID } from "@/lib/wallet";

function Stat({
  label,
  value,
  sub,
  live = false,
  danger = false,
}: {
  label: string;
  value: ReactNode;
  sub: string;
  live?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="px-6 py-4 sm:px-8">
      <div className="flex items-center gap-1.5 text-xs text-text-muted">
        {live ? <span className="live-dot h-1.5 w-1.5 rounded-full bg-safe" /> : null}
        {label}
      </div>
      <div className="mt-1 font-mono text-lg font-medium tabular-nums text-text">{value}</div>
      <div className={`text-xs ${danger ? "text-danger" : "text-text-muted"}`}>{sub}</div>
    </div>
  );
}

/**
 * Live Mezo testnet telemetry, merged into one glass bar flush to the hero's bottom edge.
 * Reads run without a connected wallet via the public client; values show a skeleton while loading.
 */
export function TelemetryBar() {
  const { data: price } = useReadContract({
    ...priceFeed,
    functionName: "fetchPrice",
    chainId: MEZO_TESTNET_CHAIN_ID,
    query: { refetchInterval: 15_000 },
  });
  const { data: liquid } = useReadContract({
    ...market,
    functionName: "liquidAssets",
    chainId: MEZO_TESTNET_CHAIN_ID,
    query: { refetchInterval: 15_000 },
  });

  const priceStr = price !== undefined ? `$${formatMusd(price as bigint)}` : <LoadingValue className="h-5 w-28" label="Loading price" />;
  const liquidStr = liquid !== undefined ? `${formatMusd(liquid as bigint)} MUSD` : <LoadingValue className="h-5 w-28" label="Loading pool" />;

  return (
    <div className="-mx-6 -mb-6 mt-10 grid grid-cols-1 divide-y divide-border border-t border-border bg-white/60 backdrop-blur-md sm:-mx-10 sm:-mb-10 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      <Stat live label="On-chain feed" value={priceStr} sub="Mezo BTC oracle" />
      <Stat label="Ready to backstop" value={liquidStr} sub="Rescue pool available" />
      <Stat danger label="Liquidation floor" value="110.0% ICR" sub="MUSD liquidates below this" />
    </div>
  );
}
