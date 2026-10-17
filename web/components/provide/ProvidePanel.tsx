"use client";

import { useState } from "react";
import { useAccount, useReadContracts } from "wagmi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApproveAndAct, safeMusd, TxNote } from "@/components/vault/shared";
import { addresses, market } from "@/lib/contracts";
import { formatMusd, formatPercent } from "@/lib/format";
import { previewWithdraw, sharesForAssets, utilisation } from "@/lib/pool";
import { useTx } from "@/hooks/useTx";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className="font-mono text-sm tabular-nums">{value}</dd>
    </div>
  );
}

/** Provider pool: deposit/withdraw MUSD and pool stats (ui_context.md page 4). */
export function ProvidePanel() {
  const { address, isConnected } = useAccount();
  const { data, refetch } = useReadContracts({
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
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Provide</h1>

      <Card>
        <CardHeader>
          <CardTitle>Rescue pool</CardTitle>
          <CardDescription>
            Deposit MUSD to fund rescues and earn fees. MUSD lent out in active rescues can&apos;t be withdrawn until
            the borrower repays.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Pool size" value={`${formatMusd(totalAssets)} MUSD`} />
            <Stat label="Available now" value={`${formatMusd(liquid)} MUSD`} />
            <Stat label="In active rescues" value={`${formatMusd(outstanding)} MUSD`} />
            <Stat label="Utilisation" value={formatPercent(utilisation(outstanding, totalAssets))} />
          </dl>
        </CardContent>
      </Card>

      {!isConnected || address === undefined ? (
        <Card>
          <CardHeader>
            <CardDescription>Connect a wallet to deposit or withdraw.</CardDescription>
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
                <Stat label="Your claim" value={`${formatMusd(myClaim)} MUSD`} />
                <Stat label="Pool share" value={formatPercent(poolShare(myShares, totalShares))} />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Deposit</CardTitle>
              <CardDescription>Approve MUSD, then deposit to the pool.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Input
                value={depositRaw}
                onChange={(e) => setDepositRaw(e.target.value)}
                placeholder="Amount (MUSD)"
                inputMode="decimal"
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
                <Input
                  value={withdrawRaw}
                  onChange={(e) => setWithdrawRaw(e.target.value)}
                  placeholder="Amount (MUSD)"
                  inputMode="decimal"
                  disabled={withdraw.busy}
                />
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
                disabled={withdraw.busy || withdrawShares === 0n || overLiquidity}
                onClick={() => withdraw.run(() => ({ ...market, functionName: "withdraw", args: [withdrawShares] }))}
              >
                {withdraw.busy ? "…" : "Withdraw"}
              </Button>
              {overLiquidity ? (
                <p className="text-sm text-danger">Only {formatMusd(liquid)} MUSD is available right now.</p>
              ) : withdrawShares > 0n ? (
                <p className="text-xs text-text-muted">You will receive ≈ {formatMusd(withdrawPayout)} MUSD.</p>
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
