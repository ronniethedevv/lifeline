import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LifelineArt } from "./LifelineArt";
import { TelemetryBar } from "./TelemetryBar";

export function Hero() {
  return (
    <section className="pt-3 sm:pt-4">
      {/* Inset rounded "stage" so the hero reads as framed, not a flat full-bleed row. */}
      <div className="relative mx-3 overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0f1217] sm:mx-6">
        {/* Atmospheric light: two soft orbs + a masked dot grid for the glass to refract. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 select-none">
          <div className="absolute -top-24 right-10 h-[520px] w-[520px] rounded-full bg-[#f7931a]/20 blur-[110px]" />
          <div className="absolute -bottom-24 -right-10 h-[480px] w-[480px] rounded-full bg-[#7c8cf8]/20 blur-[120px]" />
          <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:24px_24px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)] [-webkit-mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
        </div>

        <div className="relative mx-auto w-full max-w-6xl px-6 pb-6 pt-14 sm:px-10 sm:pb-10">
          <div className="grid grid-cols-1 items-center gap-10 py-4 lg:grid-cols-2">
            <div className="flex flex-col gap-6">
              <span className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-zinc-400">
                <span className="live-dot h-1.5 w-1.5 rounded-full bg-safe" /> Live on Mezo testnet
              </span>
              <h1 className="bg-gradient-to-b from-white via-white to-white/70 bg-clip-text text-5xl font-light leading-[1.05] tracking-[-0.04em] text-transparent sm:text-6xl lg:text-[64px]">
                Don&apos;t get
                <br />
                liquidated.
              </h1>
              <p className="max-w-md text-lg text-text-muted">
                A rescue market for Bitcoin-backed MUSD loans on Mezo. When your loan nears liquidation, providers repay
                part of it and catch you — for a fee, not your collateral.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  asChild
                  size="lg"
                  className="shadow-[0_1px_2px_rgba(0,0,0,0.4),0_10px_30px_-6px_rgba(247,147,26,0.5),inset_0_1px_0_0_rgba(255,255,255,0.35)]"
                >
                  <Link href="/vaults">Launch app</Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <a href="#how">How it works</a>
                </Button>
              </div>
              <p className="text-xs text-text-muted">
                Rescues are priced on-chain by a fuzzy risk model (1–10%) —{" "}
                <Link href="/pricer" className="text-accent underline underline-offset-2 hover:text-[#ffa028]">
                  explore the pricer →
                </Link>
              </p>
            </div>

            <div className="relative">
              <LifelineArt />
              {/* Compact glass callout anchored near the rescue dip; constrained so it never clips on mobile. */}
              <div className="callout-reveal absolute bottom-2 left-2 right-2 rounded-xl border border-white/15 bg-[#141821]/85 p-3.5 shadow-[0_16px_40px_-8px_rgba(0,0,0,0.7),inset_0_1px_0_0_rgba(255,255,255,0.15)] backdrop-blur-xl sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-[58%] sm:max-w-[230px] sm:-translate-x-1/2">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-xs text-zinc-300">
                    <span className="live-dot h-1.5 w-1.5 rounded-full bg-accent" /> Rescue triggered
                  </span>
                  <span className="rounded-full bg-lien/15 px-2 py-0.5 text-[11px] text-lien">Rescued</span>
                </div>
                <div className="mt-2 font-mono text-base font-medium tabular-nums text-white">130.0% → 150.0%</div>
                <div className="mt-0.5 text-xs text-zinc-400">
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
