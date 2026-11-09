"use client";

import { useState, type ReactNode } from "react";
import { useAccount, useReadContracts } from "wagmi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { LoadingValue } from "@/components/ui/skeleton";
import { UnitInput } from "@/components/ui/unit-input";
import { ApproveAndAct, safeMusd, TxNote } from "@/components/vault/shared";
import { addresses, market } from "@/lib/contracts";
import { formatMusd, formatPercent } from "@/lib/format";
import { previewWithdraw, sharesForAssets, utilisation } from "@/lib/pool";
import { useTx } from "@/hooks/useTx";

function Stat({ label, value, loading }: { label: string; value: ReactNode; loading?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-muted">{label}</dt>
      <dd className="font-mono text-lg tabular-nums tracking-[-0.01em] text-text">
        {loading ? <LoadingValue className="h-5 w-24" /> : value}
      </dd>
    </div>
  );
}

/** Horizontal bar: share of pool assets currently lent out in rescues. */
function UtilisationBar({ ratio }: { ratio: bigint }) {
  const pct = Math.min(100, Number((ratio * 10000n) / 10n ** 18n) / 100);
  return (
    <div className="flex flex-col gap-2">
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
        role="meter"
        aria-label="Pool utilisation"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-xs text-text-muted">
        <span>Available to withdraw</span>
        <span>Lent out in rescues</span>
      </div>
    </div>
  );
}

/** Provider pool: deposit/withdraw MUSD and pool stats (ui_context.md page 4). */
export function ProvidePanel() {
  const { address, isConnected } = useAccount();
  const { data, refetch, isLoading } = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...market, functionName: "totalAssets" }, // 0
      { ...market, functionName: "liquidAssets" }, // 1
      { ...market, functionName: "outstanding" }, // 2
      { ...market, functionName: "totalShares" }, // 3
      { ...market, functionName: "sharesOf", args: [address ?? "0x0000000000000000000000000000000000000000"] }, // 4
    ],
    query: { refetchInterval: 15_000 },
  });

  const totalAssets = (data?.[0]?.result as bigint | undefined) ?? 0n;
  const liquid = (data?.[1]?.result as bigint | undefined) ?? 0n;
  const outstanding = (data?.[2]?.result as bigint | undefined) ?? 0n;
  const totalShares = (data?.[3]?.result as bigint | undefined) ?? 0n;
  const myShares = isConnected ? ((data?.[4]?.result as bigint | undefined) ?? 0n) : 0n;
  const myClaim = previewWithdraw(myShares, totalAssets, totalShares);

  const [depositRaw, setDepositRaw] = useState("");
  const [withdrawRaw, setWithdrawRaw] = useState("");
  const depositAssets = safeMusd(depositRaw);

  const withdrawAssets = safeMusd(withdrawRaw);
  const withdrawShares =
    withdrawAssets === 0n ? 0n : min(myShares, sharesForAssets(withdrawAssets, totalAssets, totalShares));
  const withdrawPayout = previewWithdraw(withdrawShares, totalAssets, totalShares);
  const overLiquidity = withdrawPayout > liquid;
  const withdraw = useTx(() => {
    setWithdrawRaw("");
    void refetch();
  });

  return (
    <section className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Provide"
        title={
          <>
            Back loans. <span className="text-accent">Earn fees.</span>
          </>
        }
        description="Fund rescues with MUSD and earn the fee each borrower pays when they repay."
      />

      <Card>
        <CardHeader>
          <CardTitle>Rescue pool</CardTitle>
          <CardDescription>
            Deposit MUSD to fund rescues and earn fees. MUSD lent out in active rescues can&apos;t be withdrawn until
            the borrower repays.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
            <Stat loading={isLoading} label="Pool size" value={`${formatMusd(totalAssets)} MUSD`} />
            <Stat loading={isLoading} label="Available now" value={`${formatMusd(liquid)} MUSD`} />
            <Stat loading={isLoading} label="In active rescues" value={`${formatMusd(outstanding)} MUSD`} />
            <Stat loading={isLoading} label="Utilisation" value={formatPercent(utilisation(outstanding, totalAssets))} />
          </dl>
          <div className="mt-6">
            <UtilisationBar ratio={utilisation(outstanding, totalAssets)} />
          </div>
        </CardContent>
      </Card>

      {!isConnected || address === undefined ? (
        <Card>
          <CardHeader>
            <CardTitle>Connect a wallet</CardTitle>
            <CardDescription>Use the Connect button at the top right to deposit or withdraw.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Your position</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4">
                <Stat loading={isLoading} label="Your claim" value={`${formatMusd(myClaim)} MUSD`} />
                <Stat loading={isLoading} label="Pool share" value={formatPercent(poolShare(myShares, totalShares))} />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Deposit</CardTitle>
              <CardDescription>Your MUSD joins the pool and earns a share of every rescue fee.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <UnitInput
                unit="MUSD"
                aria-label="Deposit amount"
                value={depositRaw}
                onChange={(e) => setDepositRaw(e.target.value)}
                placeholder="0.00"
              />
              <ApproveAndAct
                spender={addresses.rescueMarket}
                needed={depositAssets}
                actionLabel="Deposit"
                onDone={() => {
                  setDepositRaw("");
                  void refetch();
                }}
                build={() => ({ ...market, functionName: "deposit", args: [depositAssets] })}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Withdraw</CardTitle>
              <CardDescription>Limited to the MUSD available now ({formatMusd(liquid)} MUSD).</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex gap-2">
                <div className="flex-1">
                  <UnitInput
                    unit="MUSD"
                    aria-label="Withdraw amount"
                    value={withdrawRaw}
                    onChange={(e) => setWithdrawRaw(e.target.value)}
                    placeholder="0.00"
                    disabled={withdraw.busy}
                  />
                </div>
                <Button
                  variant="outline"
                  className="shrink-0"
                  disabled={withdraw.busy || myClaim === 0n}
                  onClick={() => setWithdrawRaw(formatMusd(min(myClaim, liquid)).replace(/,/g, ""))}
                >
                  Max
                </Button>
              </div>
              <Button
                loading={withdraw.busy}
                disabled={withdraw.busy || withdrawShares === 0n || overLiquidity}
                onClick={() => withdraw.run(() => ({ ...market, functionName: "withdraw", args: [withdrawShares] }))}
              >
                Withdraw
              </Button>
              {overLiquidity ? (
                <p className="text-sm text-danger">Only {formatMusd(liquid)} MUSD is available right now.</p>
              ) : withdrawShares > 0n ? (
                <div className="flex items-center justify-between rounded-sm border border-border bg-bg-subtle p-3 text-xs">
                  <span className="text-text-muted">You receive</span>
                  <span className="font-mono tabular-nums text-text">About {formatMusd(withdrawPayout)} MUSD</span>
                </div>
              ) : null}
              <TxNote tx={withdraw} />
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/** Provider's share of the pool as a 1e18 ratio. */
function poolShare(myShares: bigint, totalShares: bigint): bigint {
  if (totalShares === 0n) return 0n;
  return (myShares * 10n ** 18n) / totalShares;
}
