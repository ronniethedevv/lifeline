"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { getAddress, type Address, type PublicClient } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { RiskBadge } from "@/components/RiskBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addresses, market, vault } from "@/lib/contracts";
import { formatBtc, formatMusd, formatPercent, parseBtc, parseMusd, parsePercent } from "@/lib/format";
import { nominalICR, validateTerms } from "@/lib/risk";
import { computeHints } from "@/lib/hints";
import { useTx } from "@/hooks/useTx";
import { useVaultSummary, type VaultSummary } from "@/hooks/useVault";
import { AmountAction, ApproveAndAct, safeMusd, TxNote } from "./shared";

/** 200 MUSD gas compensation added to every trove's debt (architecture.md §3); used for hint projections. */
const GAS_COMPENSATION = 200n * 10n ** 18n;

function hinter(client: PublicClient | undefined) {
  return (projColl: bigint, projDebt: bigint) => {
    if (!client) throw new Error("No RPC client");
    return computeHints(client, nominalICR(projColl, projDebt));
  };
}

function Stat({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className={mono ? "font-mono text-sm tabular-nums" : "text-sm"}>{value}</dd>
    </div>
  );
}

/** Loan-health summary — answers "am I safe?" at the top (ui_context.md). */
function Health({ s }: { s: VaultSummary }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Loan health</CardTitle>
          <RiskBadge state={s.risk} />
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="ICR" value={s.icr === undefined ? "—" : formatPercent(s.icr)} />
          <Stat label="Liquidation price" value={s.liqPrice === undefined ? "—" : `$${formatMusd(s.liqPrice)}`} />
          <Stat label="Debt" value={`${formatMusd(s.debt)} MUSD`} />
          <Stat label="Collateral" value={`${formatBtc(s.coll)} BTC`} />
        </dl>
        {s.lien.active ? (
          <p className="mt-4 rounded-[var(--radius)] border border-lien/40 bg-lien/10 p-3 text-sm text-lien">
            Rescued — a lien of {formatMusd(s.lien.amount)} MUSD is active. Withdrawals, borrowing and closing are
            blocked until you repay the rescue.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Open a loan inside an empty vault: BTC collateral + MUSD to borrow (min net debt 1,800). */
function OpenLoan({ address, s, onDone }: { address: Address; s: VaultSummary; onDone: () => void }) {
  const client = usePublicClient();
  const hints = hinter(client);
  const [coll, setColl] = useState("");
  const [debt, setDebt] = useState("");
  const tx = useTx(() => {
    setColl("");
    setDebt("");
    onDone();
  });
  const submit = () =>
    tx.run(async () => {
      const value = parseBtc(coll);
      const debtAmount = parseMusd(debt);
      const { upperHint, lowerHint } = await hints(value, debtAmount + GAS_COMPENSATION);
      return { ...vault(address), functionName: "open", args: [debtAmount, upperHint, lowerHint], value };
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Open a loan</CardTitle>
        <CardDescription>
          Deposit BTC as collateral and borrow MUSD. Minimum debt is 1,800 MUSD; a vault near the minimum has little
          rescue headroom.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="coll">Collateral (BTC)</Label>
          <Input id="coll" value={coll} onChange={(e) => setColl(e.target.value)} placeholder="0.05" inputMode="decimal" disabled={tx.busy} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="debt">Borrow (MUSD)</Label>
          <Input id="debt" value={debt} onChange={(e) => setDebt(e.target.value)} placeholder="1800" inputMode="decimal" disabled={tx.busy} />
        </div>
        <Button onClick={submit} disabled={tx.busy || coll.trim() === "" || debt.trim() === ""}>
          {tx.busy ? "Opening…" : "Open loan"}
        </Button>
        <TxNote tx={tx} />
        {s.price !== undefined ? <p className="text-xs text-text-muted">BTC price: ${formatMusd(s.price)}</p> : null}
      </CardContent>
    </Card>
  );
}

/** Manage an open trove: collateral, borrow/repay, refinance, claim surplus, close. */
function ManageTrove({ address, s, onDone }: { address: Address; s: VaultSummary; onDone: () => void }) {
  const client = usePublicClient();
  const hints = hinter(client);
  const lien = s.lien.active;
  const closeTx = useTx(onDone);
  const refiTx = useTx(onDone);
  const claimTx = useTx(onDone);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manage loan</CardTitle>
        <CardDescription>Add or withdraw collateral, borrow or repay MUSD.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Section label="Add collateral">
          <AmountAction
            cta="Add BTC"
            unit="BTC"
            onDone={onDone}
            build={async (amt) => {
              const { upperHint, lowerHint } = await hints(s.coll + amt, s.debt);
              return { ...vault(address), functionName: "addColl", args: [upperHint, lowerHint], value: amt };
            }}
          />
        </Section>

        <Section label="Withdraw collateral" disabledReason={lien ? "Blocked while a rescue lien is active." : undefined}>
          <AmountAction
            cta="Withdraw BTC"
            unit="BTC"
            disabled={lien}
            onDone={onDone}
            build={async (amt) => {
              const { upperHint, lowerHint } = await hints(s.coll > amt ? s.coll - amt : 0n, s.debt);
              return { ...vault(address), functionName: "withdrawColl", args: [amt, upperHint, lowerHint] };
            }}
          />
        </Section>

        <Section label="Borrow MUSD" disabledReason={lien ? "Blocked while a rescue lien is active." : undefined}>
          <AmountAction
            cta="Borrow"
            unit="MUSD"
            disabled={lien}
            onDone={onDone}
            build={async (amt) => {
              // Projection ignores the borrowing fee; hints only steer the sorted-list walk.
              const { upperHint, lowerHint } = await hints(s.coll, s.debt + amt);
              return { ...vault(address), functionName: "borrow", args: [amt, upperHint, lowerHint] };
            }}
          />
        </Section>

        <Section label="Repay MUSD" description="Approve MUSD, then repay. Lowers your debt and raises loan health.">
          <RepayDebt address={address} s={s} hints={hints} onDone={onDone} />
        </Section>

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button
            variant="outline"
            disabled={refiTx.busy}
            onClick={() =>
              refiTx.run(async () => {
                const { upperHint, lowerHint } = await hints(s.coll, s.debt);
                return { ...vault(address), functionName: "refinance", args: [upperHint, lowerHint] };
              })
            }
          >
            {refiTx.busy ? "…" : "Refinance rate"}
          </Button>
          <Button
            variant="outline"
            disabled={lien || claimTx.busy}
            onClick={() => claimTx.run(() => ({ ...vault(address), functionName: "claimCollateral" }))}
          >
            {claimTx.busy ? "…" : "Claim surplus BTC"}
          </Button>
        </div>
        <TxNote tx={refiTx} />
        <TxNote tx={claimTx} />

        <Section
          label="Close loan"
          description="Repays the full debt and returns your BTC. Approve the MUSD needed to close, then close."
          disabledReason={lien ? "Blocked while a rescue lien is active." : undefined}
        >
          <ApproveAndAct
            spender={address}
            needed={lien ? 0n : s.debt}
            actionLabel={closeTx.busy ? "…" : "Close loan"}
            disabled={lien}
            onDone={onDone}
            build={() => ({ ...vault(address), functionName: "close" })}
          />
        </Section>
      </CardContent>
    </Card>
  );
}

function RepayDebt({
  address,
  s,
  hints,
  onDone,
}: {
  address: Address;
  s: VaultSummary;
  hints: (c: bigint, d: bigint) => Promise<{ upperHint: Address; lowerHint: Address }>;
  onDone: () => void;
}) {
  const [raw, setRaw] = useState("");
  const amt = safeMusd(raw);
  return (
    <div className="flex flex-col gap-2">
      <Input value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="Amount (MUSD)" inputMode="decimal" />
      <ApproveAndAct
        spender={address}
        needed={amt}
        actionLabel="Repay"
        onDone={() => {
          setRaw("");
          onDone();
        }}
        build={async () => {
          const { upperHint, lowerHint } = await hints(s.coll, s.debt > amt ? s.debt - amt : 0n);
          return { ...vault(address), functionName: "repay", args: [amt, upperHint, lowerHint] };
        }}
      />
    </div>
  );
}

/** Rescue terms + opt-in/out (ui_context.md page 3). Blocked while a lien is active. */
function RescueTermsForm({ address, s, onDone }: { address: Address; s: VaultSummary; onDone: () => void }) {
  const lien = s.lien.active;
  const [trigger, setTrigger] = useState("");
  const [target, setTarget] = useState("");
  const [maxRescue, setMaxRescue] = useState("");
  const [err, setErr] = useState<string>();
  const save = useTx(onDone);
  const optIn = useTx(onDone);
  const optOut = useTx(onDone);

  const submit = () => {
    setErr(undefined);
    save.run(() => {
      const t = parsePercent(trigger);
      const tg = parsePercent(target);
      const mr = parseMusd(maxRescue);
      const bad = validateTerms({ mcr: s.mcr ?? 0n, triggerICR: t, targetICR: tg, maxRescue: mr });
      if (bad) {
        setErr(bad);
        throw new Error(bad);
      }
      return { ...vault(address), functionName: "setRescueTerms", args: [t, tg, mr] };
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rescue terms</CardTitle>
        <CardDescription>
          When loan health falls below your trigger, Lifeline repays part of your loan to restore the target. Trigger
          must be above {s.mcr === undefined ? "the liquidation ratio" : formatPercent(s.mcr)} and below the target.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {s.optedIn ? (
          <p className="text-sm text-safe">
            Opted in. Current terms: trigger {formatPercent(s.terms.triggerICR)}, target {formatPercent(s.terms.targetICR)},
            max rescue {formatMusd(s.terms.maxRescue)} MUSD.
          </p>
        ) : (
          <p className="text-sm text-text-muted">Not opted in — this loan cannot be rescued yet.</p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Trigger ICR (%)" value={trigger} onChange={setTrigger} placeholder="130" disabled={lien} />
          <Field label="Target ICR (%)" value={target} onChange={setTarget} placeholder="150" disabled={lien} />
          <Field label="Max rescue (MUSD)" value={maxRescue} onChange={setMaxRescue} placeholder="500" disabled={lien} />
        </div>
        {err ? <p className="text-sm text-danger">{err}</p> : null}

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={submit}
            disabled={lien || save.busy || trigger.trim() === "" || target.trim() === "" || maxRescue.trim() === ""}
          >
            {save.busy ? "Saving…" : "Save terms"}
          </Button>
          {s.optedIn ? (
            <Button
              variant="outline"
              disabled={lien || optOut.busy}
              onClick={() => optOut.run(() => ({ ...vault(address), functionName: "optOut" }))}
            >
              {optOut.busy ? "…" : "Opt out"}
            </Button>
          ) : (
            <Button
              variant="outline"
              disabled={optIn.busy}
              onClick={() => optIn.run(() => ({ ...vault(address), functionName: "optIn" }))}
            >
              {optIn.busy ? "…" : "Opt in"}
            </Button>
          )}
        </div>
        {lien ? <p className="text-sm text-text-muted">Terms are locked while a rescue lien is active.</p> : null}
        <TxNote tx={save} />
        <TxNote tx={optIn} />
        <TxNote tx={optOut} />
      </CardContent>
    </Card>
  );
}

/** Repay an active rescue lien: approve MUSD to the market, then repayLien (ui_context.md "Repay rescue"). */
function RepayRescue({ address, s, onDone }: { address: Address; s: VaultSummary; onDone: () => void }) {
  return (
    <Card className="border-lien/40">
      <CardHeader>
        <CardTitle>Repay rescue</CardTitle>
        <CardDescription>
          Repay the {formatMusd(s.lien.amount)} MUSD lien to clear it and unlock your collateral.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ApproveAndAct
          spender={addresses.rescueMarket}
          needed={s.lien.amount}
          actionLabel="Repay rescue"
          onDone={onDone}
          build={() => ({ ...market, functionName: "repayLien", args: [address] })}
        />
      </CardContent>
    </Card>
  );
}

function Section({
  label,
  description,
  disabledReason,
  children,
}: {
  label: string;
  description?: string;
  disabledReason?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-sm font-medium">{label}</h3>
      {description ? <p className="text-xs text-text-muted">{description}</p> : null}
      {children}
      {disabledReason ? <p className="text-xs text-text-muted">{disabledReason}</p> : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode="decimal" disabled={disabled} />
    </div>
  );
}

/** Vault detail page: health, manage trove, rescue terms, repay rescue (ui_context.md page 3). */
export function VaultDetail({ address }: { address: Address }) {
  const { address: account } = useAccount();
  const s = useVaultSummary(address);
  const isOwner = account !== undefined && s.owner !== undefined && getAddress(account) === getAddress(s.owner);
  const refetch = s.refetch;

  return (
    <section className="flex flex-col gap-4">
      <Link href="/vaults" className="text-sm text-text-muted hover:text-text">
        ← My vaults
      </Link>
      <h1 className="font-mono text-sm text-text-muted">{address}</h1>

      <Health s={s} />

      {s.owner !== undefined && !isOwner ? (
        <Card>
          <CardHeader>
            <CardDescription>
              You are not the owner of this vault, so it is read-only. Owner: <span className="font-mono">{s.owner}</span>
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {isOwner ? (
        <>
          {s.lien.active ? <RepayRescue address={address} s={s} onDone={refetch} /> : null}
          {s.hasTrove ? (
            <ManageTrove address={address} s={s} onDone={refetch} />
          ) : (
            <OpenLoan address={address} s={s} onDone={refetch} />
          )}
          {s.hasTrove ? <RescueTermsForm address={address} s={s} onDone={refetch} /> : null}
        </>
      ) : null}
    </section>
  );
}
