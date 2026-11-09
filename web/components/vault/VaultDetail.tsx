"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { getAddress, type Address, type PublicClient } from "viem";
import { useAccount, usePublicClient, useReadContract } from "wagmi";
import { Eyebrow, PageHeader } from "@/components/PageHeader";
import { RiskBadge } from "@/components/RiskBadge";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CostPreview, PreviewRow } from "@/components/ui/cost-preview";
import { AlertCircle, ArrowLeft, Lock } from "@/components/ui/icons";
import { Label } from "@/components/ui/label";
import { LoadingValue } from "@/components/ui/skeleton";
import { UnitInput } from "@/components/ui/unit-input";
import { addresses, borrowerOperations, market, vault } from "@/lib/contracts";
import { formatBtc, formatMusd, formatPercent, parseBtc, parseMusd, parsePercent } from "@/lib/format";
import { nominalICR, validateTerms, RISK_META } from "@/lib/risk";
import { computeHints } from "@/lib/hints";
import { useTx } from "@/hooks/useTx";
import { useVaultSummary, type VaultSummary } from "@/hooks/useVault";
import { AmountAction, ApproveAndAct, safeMusd, TxNote } from "./shared";

/** 200 MUSD gas compensation added to every trove's debt (architecture.md §3); used for hint projections. */
const GAS_COMPENSATION = 200n * 10n ** 18n;

/** Parse a BTC amount for live previews: 0n on empty or invalid input instead of throwing. */
function safeBtc(raw: string): bigint {
  try {
    return parseBtc(raw);
  } catch {
    return 0n;
  }
}

function hinter(client: PublicClient | undefined) {
  return (projColl: bigint, projDebt: bigint) => {
    if (!client) throw new Error("No RPC client");
    return computeHints(client, nominalICR(projColl, projDebt));
  };
}

function Stat({ label, value, mono = true }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className={mono ? "font-mono text-[0.95rem] tabular-nums text-text" : "text-[0.95rem] text-text"}>{value}</dd>
    </div>
  );
}

/** Risk-state token to text-colour class (matches ui_context.md risk tokens). */
const STATE_TEXT: Record<string, string> = {
  safe: "text-safe",
  watch: "text-watch",
  danger: "text-danger",
  lien: "text-lien",
  "text-muted": "text-text-muted",
};

/** Loan-health hero: answers "am I safe?" first: the state and the ratio, large (ui_context.md). */
function Health({ s }: { s: VaultSummary }) {
  const meta = RISK_META[s.risk];
  const noLoan = !s.isLoading && !s.hasTrove;
  const subtitle = s.lien.active
    ? "A rescue lien is active. Repay it to unlock your collateral."
    : noLoan
      ? "There is no loan in this vault yet."
      : s.liqPrice === undefined
        ? "Reading the live BTC price."
        : `Liquidated if BTC falls to $${formatMusd(s.liqPrice)}.`;
  return (
    <Card>
      <CardContent className="p-6 sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex flex-col gap-2.5">
            <Eyebrow>Loan health</Eyebrow>
            <span
              className={`flex items-center gap-2.5 text-[2rem] font-medium leading-none tracking-[-0.03em] ${STATE_TEXT[meta.token]}`}
            >
              <span className="h-2.5 w-2.5 rounded-full bg-current" aria-hidden />
              {meta.label}
            </span>
            <span className="text-sm text-text-muted">{subtitle}</span>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {noLoan ? (
              <span className="text-sm text-text-muted">No open loan</span>
            ) : s.icr === undefined ? (
              <LoadingValue className="h-8 w-28" label="Loading collateral ratio" />
            ) : (
              <AnimatedNumber
                value={formatPercent(s.icr)}
                className="font-mono text-[2rem] font-medium tracking-tight tabular-nums"
              />
            )}
            <span className="text-xs text-text-muted">Collateral ratio (ICR)</span>
          </div>
        </div>

        <dl className="hairline mt-6 grid grid-cols-3 gap-4 pt-5">
          <Stat label="Debt" value={s.isLoading ? <LoadingValue /> : `${formatMusd(s.debt)} MUSD`} />
          <Stat label="Collateral" value={s.isLoading ? <LoadingValue /> : `${formatBtc(s.coll)} BTC`} />
          <Stat label="BTC price" value={s.price === undefined ? <LoadingValue /> : `$${formatMusd(s.price)}`} />
        </dl>

        {s.lien.active ? (
          <div className="mt-5 flex items-start gap-2.5 rounded-sm border border-lien/25 bg-lien/10 p-3.5 text-sm text-lien">
            <Lock className="mt-0.5" />
            <p>
              Rescued. A lien of <span className="font-mono tabular-nums">{formatMusd(s.lien.amount)} MUSD</span> is
              active. Withdrawals, borrowing and closing are blocked until you repay the rescue.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Open a loan inside an empty vault: BTC collateral + MUSD to borrow (min net debt read on-chain). */
function OpenLoan({ address, s, onDone }: { address: Address; s: VaultSummary; onDone: () => void }) {
  const client = usePublicClient();
  const hints = hinter(client);
  const [coll, setColl] = useState("");
  const [debt, setDebt] = useState("");
  const { data: minNetDebtData } = useReadContract({ ...borrowerOperations, functionName: "minNetDebt" });
  const minNetDebt = minNetDebtData as bigint | undefined;
  const minLabel = minNetDebt !== undefined ? formatMusd(minNetDebt) : "1,800.00";
  const belowMin = minNetDebt !== undefined && safeMusd(debt) > 0n && safeMusd(debt) < minNetDebt;
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

  // Live pre-sign projection (ignores the small borrowing fee).
  const collWei = safeBtc(coll);
  const debtWei = safeMusd(debt);
  const totalDebt = debtWei + GAS_COMPENSATION;
  const price = s.price;
  const preview =
    price !== undefined && collWei > 0n && debtWei > 0n
      ? { value: (collWei * price) / 10n ** 18n, icr: (collWei * price) / totalDebt }
      : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Open a loan</CardTitle>
        <CardDescription>
          Deposit BTC as collateral and borrow MUSD. The minimum borrow is {minLabel} MUSD, and a loan close to the
          minimum has little room to be rescued.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="coll">Collateral</Label>
            <UnitInput id="coll" unit="BTC" value={coll} onChange={(e) => setColl(e.target.value)} placeholder="0.05" disabled={tx.busy} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="debt">Borrow</Label>
            <UnitInput id="debt" unit="MUSD" value={debt} onChange={(e) => setDebt(e.target.value)} placeholder="1,800" disabled={tx.busy} />
          </div>
        </div>
        {belowMin ? (
          <p className="flex items-center gap-1.5 text-sm text-danger">
            <AlertCircle />
            The minimum borrow is {minLabel} MUSD.
          </p>
        ) : null}
        {preview ? (
          <CostPreview>
            <PreviewRow label="Collateral value" value={`$${formatMusd(preview.value)}`} />
            <PreviewRow label="Debt incl. 200 MUSD gas reserve" value={`${formatMusd(totalDebt)} MUSD`} />
            <PreviewRow label="Starting loan health" value={<AnimatedNumber value={formatPercent(preview.icr)} />} emphasis />
          </CostPreview>
        ) : null}
        <Button onClick={submit} loading={tx.busy} disabled={coll.trim() === "" || debt.trim() === "" || belowMin}>
          Open loan
        </Button>
        <TxNote tx={tx} />
      </CardContent>
    </Card>
  );
}

/** Manage an open trove: collateral, borrow/repay, refinance, claim surplus, close. */
function ManageTrove({ address, s, onDone }: { address: Address; s: VaultSummary; onDone: () => void }) {
  const client = usePublicClient();
  const hints = hinter(client);
  const lien = s.lien.active;
  const lienReason = lien ? "Blocked while a rescue lien is active." : undefined;
  const refiTx = useTx(onDone);
  const claimTx = useTx(onDone);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manage loan</CardTitle>
        <CardDescription>Add or withdraw collateral, borrow more or repay MUSD.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-border">
        <Section label="Add collateral" description="Raises loan health immediately.">
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

        <Section label="Withdraw collateral" disabledReason={lienReason}>
          <AmountAction
            cta="Withdraw"
            unit="BTC"
            disabled={lien}
            onDone={onDone}
            build={async (amt) => {
              const { upperHint, lowerHint } = await hints(s.coll > amt ? s.coll - amt : 0n, s.debt);
              return { ...vault(address), functionName: "withdrawColl", args: [amt, upperHint, lowerHint] };
            }}
          />
        </Section>

        <Section label="Borrow MUSD" disabledReason={lienReason}>
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

        <Section label="Repay MUSD" description="Lowers your debt and raises loan health.">
          <RepayDebt address={address} s={s} hints={hints} onDone={onDone} />
        </Section>

        <Section label="More actions">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              loading={refiTx.busy}
              onClick={() =>
                refiTx.run(async () => {
                  const { upperHint, lowerHint } = await hints(s.coll, s.debt);
                  return { ...vault(address), functionName: "refinance", args: [upperHint, lowerHint] };
                })
              }
            >
              Refinance rate
            </Button>
            <Button
              variant="outline"
              size="sm"
              loading={claimTx.busy}
              disabled={lien}
              onClick={() => claimTx.run(() => ({ ...vault(address), functionName: "claimCollateral" }))}
            >
              Claim surplus BTC
            </Button>
          </div>
          <TxNote tx={refiTx} />
          <TxNote tx={claimTx} />
        </Section>

        <Section
          label="Close loan"
          description="Repays the full debt and returns all of your BTC."
          disabledReason={lienReason}
        >
          <ApproveAndAct
            spender={address}
            needed={lien ? 0n : s.debt}
            actionLabel="Close loan"
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
      <UnitInput unit="MUSD" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="0.00" aria-label="Amount to repay in MUSD" />
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
        <div className="flex items-start justify-between gap-4">
          <CardTitle>Rescue terms</CardTitle>
          {s.optedIn ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-safe/25 bg-safe/10 px-2.5 py-1 text-xs font-medium text-safe">
              <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
              Opted in
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs font-medium text-text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
              Not opted in
            </span>
          )}
        </div>
        <CardDescription>
          When loan health falls below your trigger, Lifeline repays part of your loan to restore the target. The
          trigger must sit at least 20 points above the {s.mcr === undefined ? "" : `${formatPercent(s.mcr)} `}
          liquidation ratio and below the target.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {s.optedIn ? (
          <dl className="grid grid-cols-3 gap-4 rounded-[12px] border border-border bg-bg-subtle p-4">
            <Stat label="Trigger" value={formatPercent(s.terms.triggerICR)} />
            <Stat label="Target" value={formatPercent(s.terms.targetICR)} />
            <Stat label="Max rescue" value={`${formatMusd(s.terms.maxRescue)} MUSD`} />
          </dl>
        ) : (
          <p className="text-sm text-text-muted">This loan cannot be rescued until you set terms and opt in.</p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field id="trigger" label="Trigger" unit="%" value={trigger} onChange={setTrigger} placeholder="130" disabled={lien} />
          <Field id="target" label="Target" unit="%" value={target} onChange={setTarget} placeholder="150" disabled={lien} />
          <Field id="max" label="Max rescue" unit="MUSD" value={maxRescue} onChange={setMaxRescue} placeholder="500" disabled={lien} />
        </div>
        {err ? (
          <p className="flex items-center gap-1.5 text-sm text-danger">
            <AlertCircle />
            {err}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={submit}
            loading={save.busy}
            disabled={lien || trigger.trim() === "" || target.trim() === "" || maxRescue.trim() === ""}
          >
            Save terms
          </Button>
          {s.optedIn ? (
            <Button
              variant="outline"
              loading={optOut.busy}
              disabled={lien}
              onClick={() => optOut.run(() => ({ ...vault(address), functionName: "optOut" }))}
            >
              Opt out
            </Button>
          ) : (
            <Button
              variant="outline"
              loading={optIn.busy}
              onClick={() => optIn.run(() => ({ ...vault(address), functionName: "optIn" }))}
            >
              Opt in
            </Button>
          )}
        </div>
        {lien ? (
          <p className="flex items-center gap-1.5 text-xs text-text-muted">
            <Lock className="h-3.5 w-3.5" />
            Terms are locked while a rescue lien is active.
          </p>
        ) : null}
        <TxNote tx={save} />
        <TxNote tx={optIn} />
        <TxNote tx={optOut} />
      </CardContent>
    </Card>
  );
}

/** Repay an active rescue lien: approve MUSD to the market, then repayLien (ui_context.md "Repay rescue"). */
function RepayRescue({ address, s, onDone }: { address: Address; s: VaultSummary; onDone: () => void }) {
  const due = new Date(Number(s.lien.dueBy) * 1000);
  const overdue = Date.now() > due.getTime();
  const dueLabel = due.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <Card className="border-lien/30">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <CardTitle>Repay rescue</CardTitle>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-lien/25 bg-lien/10 px-2.5 py-1 text-xs font-medium text-lien">
            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
            Lien active
          </span>
        </div>
        <CardDescription>Repaying clears the lien and unlocks your collateral.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <CostPreview title="Amount due">
          <PreviewRow label="Lien (repaid debt, fee and keeper tip)" value={`${formatMusd(s.lien.amount)} MUSD`} emphasis />
          <PreviewRow label={overdue ? "Was due" : "Due by"} value={dueLabel} />
        </CostPreview>
        {overdue ? (
          <p className="flex items-center gap-1.5 text-sm text-danger">
            <AlertCircle />
            This lien is past due. Repay it to keep full control of your collateral.
          </p>
        ) : null}
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
    <div className="flex flex-col gap-2.5 py-5 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-medium text-text">{label}</h3>
        {description ? <p className="text-xs text-text-muted">{description}</p> : null}
      </div>
      {children}
      {disabledReason ? (
        <p className="flex items-center gap-1.5 text-xs text-text-muted">
          <Lock className="h-3.5 w-3.5" />
          {disabledReason}
        </p>
      ) : null}
    </div>
  );
}

function Field({
  id,
  label,
  unit,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  id: string;
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <UnitInput
        id={id}
        unit={unit}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
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
    <section className="flex flex-col gap-5">
      <Link
        href="/vaults"
        className="group inline-flex w-fit items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-text"
      >
        <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
        My vaults
      </Link>
      <PageHeader
        eyebrow="Vault"
        title="Loan overview"
        description={<span className="break-all font-mono text-xs">{address}</span>}
        actions={<RiskBadge state={s.risk} />}
      />

      <Health s={s} />

      {s.owner !== undefined && !isOwner ? (
        <div className="flex items-start gap-2.5 rounded-[12px] border border-border bg-bg-subtle p-4 text-sm text-text-muted">
          <Lock className="mt-0.5" />
          <p>
            You are not the owner of this vault, so it is read-only. Owner{" "}
            <span className="break-all font-mono text-text">{s.owner}</span>
          </p>
        </div>
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
