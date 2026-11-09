import Link from "next/link";
import { ArrowPill } from "@/components/ui/arrow-pill";
import { DotMatrix } from "@/components/ui/dot-matrix";
import { ArrowRight } from "@/components/ui/icons";
import { LifelineArt } from "./LifelineArt";
import { TelemetryBar } from "./TelemetryBar";

export function Hero() {
  return (
    <section className="pt-3 sm:pt-4">
      {/* Inset light "stage" so the hero reads as framed, with a faint warm daylight glow. */}
      <div className="relative mx-3 overflow-hidden rounded-lg border border-border bg-bg-subtle sm:mx-6">
        <div aria-hidden className="hero-glow pointer-events-none absolute inset-0 select-none" />

        <div className="relative mx-auto w-full max-w-6xl px-6 pb-6 pt-14 sm:px-10 sm:pb-10">
          <div className="grid grid-cols-1 items-center gap-10 py-4 lg:grid-cols-2">
            <div className="flex flex-col gap-6">
              <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-white px-3 py-1 text-xs text-text-muted">
                <span className="live-dot h-1.5 w-1.5 rounded-full bg-safe" /> Live on Mezo testnet
              </span>
              <DotMatrix size={5} highlight={12} />
              <h1 className="text-5xl font-normal leading-[1.06] tracking-[-0.04em] sm:text-6xl lg:text-[64px]">
                Keep your Bitcoin.
                <br />
                <span className="text-accent">Never get liquidated.</span>
              </h1>
              <p className="max-w-md text-lg text-text-muted">
                A rescue market for Bitcoin-backed MUSD loans on Mezo. When your loan nears liquidation, providers repay
                part of it and catch you. You pay a fee, not your collateral.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <ArrowPill href="/vaults" variant="primary" className="h-11 text-[0.95rem]">
                  Launch app
                </ArrowPill>
                <ArrowPill href="#how" variant="secondary" className="h-11 text-[0.95rem]">
                  How it works
                </ArrowPill>
              </div>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
                Rescue fees of 1% to 10%, priced on-chain by a fuzzy risk model.
                <Link
                  href="/pricer"
                  className="group inline-flex items-center gap-1 font-medium text-accent hover:text-[#e2860e]"
                >
                  Explore the pricer
                  <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </p>
            </div>

            <div className="relative">
              <LifelineArt />
              {/* Light glass callout anchored near the rescue dip; constrained so it never clips on mobile. */}
              <div className="callout-reveal card-elevated absolute bottom-2 left-2 right-2 rounded-[12px] p-3.5 sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-[58%] sm:max-w-[230px] sm:-translate-x-1/2">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-xs text-text-muted">
                    <span className="live-dot h-1.5 w-1.5 rounded-full bg-accent" /> Rescue triggered
                  </span>
                  <span className="rounded-full border border-lien/25 bg-lien/10 px-2 py-0.5 text-[11px] text-lien">
                    Rescued
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2 font-mono text-base font-medium tabular-nums text-text">
                  <span className="text-text-muted">130.0%</span>
                  <ArrowRight className="h-3.5 w-3.5 text-accent" />
                  <span>150.0%</span>
                </div>
                <div className="mt-0.5 text-xs text-text-muted">
                  <span className="font-mono tabular-nums">+2,500.00</span> MUSD injected
                </div>
              </div>
            </div>
          </div>

          <TelemetryBar />
        </div>
      </div>
    </section>
  );
}
