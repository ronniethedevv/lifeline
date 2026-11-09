"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { Address } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { PageHeader } from "@/components/PageHeader";
import { RiskBadge } from "@/components/RiskBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DotMatrix } from "@/components/ui/dot-matrix";
import { ArrowRight } from "@/components/ui/icons";
import { LoadingValue } from "@/components/ui/skeleton";
import { TxNote } from "@/components/vault/shared";
import { factory } from "@/lib/contracts";
import { formatBtc, formatMusd, formatPercent } from "@/lib/format";
import { useVaultSummary } from "@/hooks/useVault";
import { useTx } from "@/hooks/useTx";

const COLS = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:grid-cols-[minmax(0,1.4fr)_0.8fr_0.9fr_0.9fr_auto]";

function Figure({ value }: { value: ReactNode }) {
  return <span className="hidden text-right font-mono text-sm tabular-nums text-text sm:block">{value}</span>;
}

/** One interactive row: a compact health view that links to the vault detail page. */
function VaultRow({ address }: { address: Address }) {
  const s = useVaultSummary(address);
  const noLoan = !s.isLoading && !s.hasTrove;
  const health = noLoan ? (
    <span className="text-text-muted">No loan</span>
  ) : s.icr === undefined ? (
    <LoadingValue />
  ) : (
    formatPercent(s.icr)
  );
  return (
    <Link
      href={`/vaults/${address}`}
      className={`group ${COLS} rounded-[12px] px-3 py-3.5 transition-colors hover:bg-surface-2/80`}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="truncate font-mono text-sm text-text">{address}</span>
        <RiskBadge state={s.risk} className="w-fit" />
      </div>
      <Figure value={health} />
      <Figure value={s.isLoading ? <LoadingValue /> : `${formatMusd(s.debt)} MUSD`} />
      <Figure value={s.isLoading ? <LoadingValue /> : `${formatBtc(s.coll)} BTC`} />
      <span className="inline-flex shrink-0 items-center gap-1.5 justify-self-end rounded-full border border-border bg-white px-3 py-1.5 text-xs font-medium text-text-muted transition-colors group-hover:border-accent/30 group-hover:bg-accent/10 group-hover:text-accent">
        Manage
        <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

/** "My vaults": lists the connected owner's vaults and creates new ones (ui_context.md page 2). */
export function VaultsList() {
  const { address, isConnected } = useAccount();
  const { data: vaults, refetch } = useReadContract({
    ...factory,
    functionName: "vaultsOf",
    args: address ? [address] : undefined,
    query: { enabled: isConnected && address !== undefined },
  });
  const create = useTx(() => void refetch());

  const header = (actions?: ReactNode) => (
    <PageHeader
      eyebrow="Borrow"
      title={
        <>
          My <span className="text-accent">vaults</span>
        </>
      }
      description="Each vault holds one MUSD loan that Lifeline can rescue before it is liquidated."
      actions={actions}
    />
  );

  if (!isConnected || address === undefined) {
    return (
      <section className="flex flex-col gap-6">
        {header()}
        <Card>
          <CardHeader>
            <CardTitle>Connect a wallet</CardTitle>
            <CardDescription>Use the Connect button at the top right to see your loans and create a vault.</CardDescription>
          </CardHeader>
        </Card>
      </section>
    );
  }

  const list = (vaults ?? []) as readonly Address[];
  return (
    <section className="flex flex-col gap-6">
      {header(
        <Button loading={create.busy} onClick={() => create.run(() => ({ ...factory, functionName: "createVault" }))}>
          Create vault
        </Button>,
      )}
      <TxNote tx={create} />

      {list.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <DotMatrix size={5} highlight={12} />
            <h2 className="text-lg font-medium tracking-[-0.02em]">No vaults yet</h2>
            <p className="max-w-sm text-sm text-text-muted">
              A vault owns one MUSD loan and lets Lifeline rescue it. Create one, then open a loan inside it.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col p-2">
            <div
              className={`${COLS} border-b border-border px-3 pb-2.5 pt-2 text-[11px] font-medium uppercase tracking-[0.14em] text-text-muted`}
            >
              <span>Vault</span>
              <span className="hidden text-right sm:block">Loan health</span>
              <span className="hidden text-right sm:block">Debt</span>
              <span className="hidden text-right sm:block">Collateral</span>
              <span className="sr-only">Action</span>
            </div>
            <div className="flex flex-col divide-y divide-border">
              {list.map((v) => (
                <VaultRow key={v} address={v} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
