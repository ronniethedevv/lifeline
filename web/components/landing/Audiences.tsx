import Link from "next/link";
import { Button } from "@/components/ui/button";

export function Audiences() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 pb-20">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Borrowers (orange context) */}
        <div className="card-specular relative overflow-hidden p-6 transition-colors hover:border-[#f7931a]/40">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_0%,rgba(247,147,26,0.09),transparent)]"
          />
          <div className="relative">
            <BorrowerWidget />
            <span className="font-mono text-xs uppercase tracking-[0.08em] text-accent">For borrowers →</span>
            <h3 className="mt-3 text-2xl font-normal tracking-[-0.035em] text-white">Keep your Bitcoin through the dip.</h3>
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

        {/* Providers (violet context) */}
        <div className="card-specular relative overflow-hidden p-6 transition-colors hover:border-[#7c8cf8]/40">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_0%,rgba(124,140,248,0.09),transparent)]"
          />
          <div className="relative">
            <ProviderWidget />
            <span className="font-mono text-xs uppercase tracking-[0.08em] text-lien">For providers →</span>
            <h3 className="mt-3 text-2xl font-normal tracking-[-0.035em] text-white">Earn fees backstopping loans.</h3>
            <p className="mt-2 text-sm text-text-muted">
              Deposit MUSD into the rescue pool. Every rescue books a fee and a senior claim on the borrower&apos;s BTC —
              priced on-chain, repaid before they can withdraw.
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
    <div
      aria-hidden
      className="mb-7 rounded-xl border border-white/[0.08] bg-[#0b0d11]/90 p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_12px_24px_-6px_rgba(0,0,0,0.5)]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-zinc-400">Collateral Ratio (ICR)</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-lien/15 px-2 py-0.5 text-[11px] text-lien">
          <span className="h-1.5 w-1.5 rounded-full bg-lien" /> Rescued · Safe
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-2.5">
        <span className="font-mono text-3xl font-medium tracking-tight tabular-nums text-white">150.0%</span>
        <span className="font-mono text-sm tabular-nums text-watch/70 line-through">116.5%</span>
      </div>
      <div className="relative mt-4 h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-accent to-lien" style={{ width: "75%" }} />
        <div className="absolute inset-y-0 w-px bg-danger" style={{ left: "15%" }} />
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
          <span className="flex items-center gap-2 text-zinc-400">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Protected collateral
          </span>
          <span className="font-mono tabular-nums text-white">1.25000000 BTC</span>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
          <span className="flex items-center gap-2 text-zinc-400">
            <span className="h-1.5 w-1.5 rounded-full bg-lien" /> Active rescue lien
          </span>
          <span className="font-mono tabular-nums text-white">2,500.00 MUSD</span>
        </div>
      </div>
    </div>
  );
}

/** Illustrative provider pool-position (decorative). */
function ProviderWidget() {
  return (
    <div
      aria-hidden
      className="mb-7 rounded-xl border border-white/[0.08] bg-[#0b0d11]/90 p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_12px_24px_-6px_rgba(0,0,0,0.5)]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-zinc-400">Your Pool Position</span>
        <span className="rounded-full bg-lien/15 px-2 py-0.5 text-[11px] text-lien">Earning rescue fees</span>
      </div>
      <div className="mt-2 flex items-center gap-2.5">
        <span className="font-mono text-3xl font-medium tracking-tight tabular-nums text-white">25,000.00</span>
        <span className="rounded-full border border-[#7c8cf8]/30 bg-[#7c8cf8]/15 px-2.5 py-0.5 font-mono text-xs text-[#7c8cf8]">
          MUSD
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <div className="rounded-lg bg-white/[0.03] p-2.5">
          <div className="text-xs text-zinc-400">Pool Share</div>
          <div className="mt-0.5 font-mono text-sm tabular-nums text-white">8.40%</div>
        </div>
        <div className="rounded-lg bg-white/[0.03] p-2.5">
          <div className="text-xs text-zinc-400">In Active Rescues</div>
          <div className="mt-0.5 font-mono text-sm tabular-nums text-[#7c8cf8]">6,420.00 MUSD</div>
        </div>
      </div>
    </div>
  );
}
