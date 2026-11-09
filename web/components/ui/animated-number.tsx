"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** One rolling 0-9 column; the track slides to show digit `d`. */
function DigitColumn({ d }: { d: number }) {
  return (
    <span className="odometer-col" aria-hidden>
      <span className="odometer-track" style={{ transform: `translateY(-${d}em)` }}>
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i}>{i}</span>
        ))}
      </span>
    </span>
  );
}

/**
 * Rolls preformatted numeric readouts digit-by-digit when `value` changes (Pricer fee, ICR, MUSD
 * cost). `value` is already formatted (e.g. "3.85%", "1,800.00"); digits roll, separators stay put.
 */
export function AnimatedNumber({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-stretch leading-none tabular-nums", className)} aria-label={value}>
      {[...value].map((ch, i) =>
        /\d/.test(ch) ? (
          <DigitColumn key={i} d={Number(ch)} />
        ) : (
          <span key={i} aria-hidden>
            {ch}
          </span>
        ),
      )}
    </span>
  );
}
