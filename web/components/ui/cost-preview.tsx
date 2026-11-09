import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Pre-signature breakdown (MUSD, BTC, fee, resulting health) shown as a nested Tier-3 card. */
export function CostPreview({ title = "Before you sign", children }: { title?: string; children: ReactNode }) {
  return (
    <div className="reveal-up rounded-[12px] border border-border bg-bg-subtle p-3.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-muted">{title}</span>
      <dl className="mt-2.5 flex flex-col gap-2">{children}</dl>
    </div>
  );
}

export function PreviewRow({ label, value, emphasis = false }: { label: string; value: ReactNode; emphasis?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <dt className="text-text-muted">{label}</dt>
      <dd className={cn("font-mono tabular-nums text-text", emphasis && "font-medium")}>{value}</dd>
    </div>
  );
}
