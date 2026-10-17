"use client";

import { useEffect, useRef, useState } from "react";

const STEPS: { n: string; title: string; body: string }[] = [
  {
    n: "01",
    title: "Set your rescue terms",
    body: "Pick the loan-health trigger, the target to restore it to, and the most you'll let the market repay.",
  },
  {
    n: "02",
    title: "The market watches",
    body: "Providers pool MUSD. A keeper tracks your loan health against the live BTC price, around the clock.",
  },
  {
    n: "03",
    title: "Rescue fires in time",
    body: "If health hits your trigger, the pool repays just enough to pull you back to target — before liquidation.",
  },
  {
    n: "04",
    title: "Repay, on your terms",
    body: "The rescue becomes a short-term lien on your BTC. Clear it to unlock your collateral — and keep its upside.",
  },
];

export function Steps() {
  const trackRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const root = trackRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const idx = cardRefs.current.indexOf(e.target as HTMLDivElement);
            if (idx >= 0) setActive(idx);
          }
        }
      },
      { root, threshold: 0.6 },
    );
    for (const c of cardRefs.current) if (c) io.observe(c);
    return () => io.disconnect();
  }, []);

  const goTo = (i: number) => {
    const reduce =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    cardRefs.current[i]?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", inline: "center", block: "nearest" });
  };

  return (
    <section id="how" className="mx-auto w-full max-w-6xl overflow-x-hidden px-6 pb-12 pt-24">
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 text-center">
        <span className="font-mono text-xs uppercase tracking-[0.08em] text-accent">How a rescue works</span>
        <h2 className="bg-gradient-to-b from-white via-white to-white/70 bg-clip-text text-3xl font-light leading-[1.1] tracking-[-0.04em] text-transparent sm:text-4xl">
          A backstop that acts before the 110% line, not after.
        </h2>
      </div>

      <div
        ref={trackRef}
        className="-mx-6 mt-12 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-2 scrollbar-none md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 lg:grid-cols-4"
      >
        {STEPS.map((s, i) => (
          <div
            key={s.n}
            ref={(el) => {
              cardRefs.current[i] = el;
            }}
            className="card-specular flex min-w-[82%] snap-center flex-col p-5 sm:min-w-[60%] md:min-w-0"
          >
            <span className="mb-6 font-mono text-2xl font-light text-[#f7931a]/80">{s.n}</span>
            <div className="border-t border-white/[0.06] pt-4">
              <h3 className="text-base font-medium text-white">{s.title}</h3>
              <p className="mt-2 text-sm text-text-muted">{s.body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex justify-center md:hidden">
        <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">
          {STEPS.map((s, i) => (
            <button
              key={s.n}
              type="button"
              aria-label={`Go to step ${i + 1}`}
              onClick={() => goTo(i)}
              className="flex h-7 items-center justify-center px-1"
            >
              <span
                className={
                  i === active
                    ? "h-1.5 w-6 rounded-full bg-accent transition-all duration-300"
                    : "h-1.5 w-1.5 rounded-full bg-white/25 transition-all duration-300"
                }
              />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
