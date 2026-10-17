"use client";

import { useBitcoinAccount } from "@mezo-org/passport";
import { useAccount, useBalance, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBtc } from "@/lib/format";
import { MEZO_TESTNET_CHAIN_ID } from "@/lib/wallet";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className="break-all font-mono text-sm tabular-nums">{value}</dd>
    </div>
  );
}

/** Who is connected, on which network, and with what balance (T2.3). */
export function AccountPanel() {
  const { address, chainId, isConnected } = useAccount();
  const { btcAddress } = useBitcoinAccount();
  const { data: balance } = useBalance({ address, chainId: MEZO_TESTNET_CHAIN_ID, query: { enabled: isConnected } });
  const { switchChain, isPending: switching } = useSwitchChain();

  if (!isConnected || address === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Connect a wallet</CardTitle>
          <CardDescription>
            Use a Bitcoin wallet (Unisat, OKX, Xverse) or an EVM wallet on Mezo testnet to manage your loan.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (chainId !== MEZO_TESTNET_CHAIN_ID) {
    return (
      <Card className="border-danger">
        <CardHeader>
          <CardTitle>
            <span className="text-danger">Wrong network</span>: switch to Mezo testnet
          </CardTitle>
          <CardDescription>Lifeline runs on Mezo testnet (chain {MEZO_TESTNET_CHAIN_ID}).</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => switchChain({ chainId: MEZO_TESTNET_CHAIN_ID })} disabled={switching}>
            {switching ? "Switching…" : "Switch to Mezo testnet"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="text-safe">Connected</span> to Mezo testnet
        </CardTitle>
        {btcAddress ? (
          <CardDescription>
            Bitcoin wallet via Mezo Passport. Transactions are sent from your Mezo account below, which your
            Bitcoin wallet controls.
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col gap-3">
          {btcAddress ? <Row label="Bitcoin address" value={btcAddress} /> : null}
          <Row label="Mezo account" value={address} />
          <Row label="Balance" value={balance === undefined ? "…" : `${formatBtc(balance.value)} BTC`} />
        </dl>
      </CardContent>
    </Card>
  );
}
