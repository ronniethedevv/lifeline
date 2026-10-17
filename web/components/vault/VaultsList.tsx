"use client";

import Link from "next/link";
import type { Address } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { RiskBadge } from "@/components/RiskBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { factory } from "@/lib/contracts";
import { formatBtc, formatMusd, formatPercent } from "@/lib/format";
import { useVaultSummary } from "@/hooks/useVault";
import { useTx } from "@/hooks/useTx";

/** One row in the list: a compact health view linking to the vault detail page. */
function VaultCard({ address }: { address: Address }) {
  const s = useVaultSummary(address);
  return (
    <Link href={`/vaults/${address}`} className="block">
      <Card className="transition-colors hover:border-text-muted">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-sm text-text-muted">{address}</span>
            <RiskBadge state={s.risk} />
          </div>
          <dl className="flex gap-6 text-sm">
            <div>
              <dt className="text-text-muted">Loan health</dt>
              <dd className="font-mono tabular-nums">{s.icr === undefined ? "—" : formatPercent(s.icr)}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Debt</dt>
              <dd className="font-mono tabular-nums">{formatMusd(s.debt)}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Collateral</dt>
              <dd className="font-mono tabular-nums">{formatBtc(s.coll)} BTC</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
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

  if (!isConnected || address === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Connect a wallet</CardTitle>
          <CardDescription>Connect to see your loans and create a vault.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const list = (vaults ?? []) as readonly Address[];
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My vaults</h1>
        <Button onClick={() => create.run(() => ({ ...factory, functionName: "createVault" }))} disabled={create.busy}>
          {create.busy ? "Creating…" : "Create vault"}
        </Button>
      </div>
      {create.error ? <p className="text-sm text-danger">{create.error}</p> : null}

      {list.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No vaults yet</CardTitle>
            <CardDescription>
              A vault owns one MUSD loan and lets Lifeline rescue it. Create one, then open a loan inside it.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {list.map((v) => (
            <VaultCard key={v} address={v} />
          ))}
        </div>
      )}
    </section>
  );
}
