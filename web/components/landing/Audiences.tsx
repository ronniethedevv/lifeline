import Link from "next/link";
import { Button } from "@/components/ui/button";

export function Audiences() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 pb-20">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Borrowers (orange context) */}
        <div className="card-specular relative overflow-hidden p-6 transition-colors hover:border-accent/40">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_0%,rgba(247,147,26,0.06),transparent)]"
          />
          <div className="relative">
            <BorrowerWidget />
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
              For borrowers
            </span>
            <h3 className="mt-3 text-2xl font-normal tracking-[-0.035em] text-text">Keep your Bitcoin through the dip.</h3>
            <p className="mt-2 text-sm text-text-muted">
              Liquidation costs up to ~10% of your collateral and all its upside. Opt in once, set your terms, and let
              the market defend your loan while you sleep.
            </p>
            <div className="mt-5">
              <Button asChild variant="outline">
                <Link href="/vaults">Open a vault</Link>
              </Button>
            </div>
          </div>
        </div>

        {/* Providers (indigo context) */}
        <div className="card-specular relative overflow-hidden p-6 transition-colors hover:border-lien/40">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_0%,rgba(79,70,229,0.06),transparent)]"
          />
          <div className="relative">
            <ProviderWidget />
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-lien">
              <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
              For providers
            </span>
            <h3 className="mt-3 text-2xl font-normal tracking-[-0.035em] text-text">Earn fees backstopping loans.</h3>
            <p className="mt-2 text-sm text-text-muted">
              Deposit MUSD into the rescue pool. Every rescue earns a fee of 1% to 10%, priced on-chain by a fuzzy risk
              model, and is secured by a lien on the borrower&apos;s BTC until it is repaid.
            </p>
            <div className="mt-5">
              <Button asChild variant="outline">
                <Link href="/provide">Provide liquidity</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Illustrative vault-health cockpit (decorative). */
function BorrowerWidget() {
  return (
    <div aria-hidden className="mb-7 rounded-[12px] border border-border bg-bg-subtle p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-text-muted">Collateral Ratio (ICR)</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-lien/25 bg-lien/10 px-2 py-0.5 text-[11px] text-lien">
          <span className="h-1.5 w-1.5 rounded-full bg-lien" /> Rescued · Safe
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-2.5">
        <span className="font-mono text-3xl font-medium tracking-tight tabular-nums text-text">150.0%</span>
        <span className="font-mono text-sm tabular-nums text-watch line-through">116.5%</span>
      </div>
      <div className="relative mt-4 h-2 overflow-hidden rounded-full bg-surface-2">
        <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-accent to-lien" style={{ width: "75%" }} />
        <div className="absolute inset-y-0 w-px bg-danger" style={{ left: "15%" }} />
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <div className="flex items-center justify-between rounded-sm border border-border bg-white px-3 py-2 text-xs">
          <span className="flex items-center gap-2 text-text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Protected collateral
          </span>
          <span className="font-mono tabular-nums text-text">1.25000000 BTC</span>
        </div>
        <div className="flex items-center justify-between rounded-sm border border-border bg-white px-3 py-2 text-xs">
          <span className="flex items-center gap-2 text-text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-lien" /> Active rescue lien
          </span>
          <span className="font-mono tabular-nums text-text">2,500.00 MUSD</span>
        </div>
      </div>
    </div>
  );
}

/** Illustrative provider pool-position (decorative). */
function ProviderWidget() {
  return (
    <div aria-hidden className="mb-7 rounded-[12px] border border-border bg-bg-subtle p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-text-muted">Your Pool Position</span>
        <span className="rounded-full border border-lien/25 bg-lien/10 px-2 py-0.5 text-[11px] text-lien">Earning rescue fees</span>
      </div>
      <div className="mt-2 flex items-center gap-2.5">
        <span className="font-mono text-3xl font-medium tracking-tight tabular-nums text-text">25,000.00</span>
        <span className="rounded-full border border-lien/25 bg-lien/10 px-2.5 py-0.5 font-mono text-xs text-lien">MUSD</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <div className="rounded-sm border border-border bg-white p-2.5">
          <div className="text-xs text-text-muted">Pool Share</div>
          <div className="mt-0.5 font-mono text-sm tabular-nums text-text">8.40%</div>
        </div>
        <div className="rounded-sm border border-border bg-white p-2.5">
          <div className="text-xs text-text-muted">In Active Rescues</div>
          <div className="mt-0.5 font-mono text-sm tabular-nums text-lien">6,420.00 MUSD</div>
        </div>
      </div>
    </div>
  );
}
