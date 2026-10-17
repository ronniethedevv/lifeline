/**
 * The signature visual: a loan's health falling toward the 110% liquidation line and being
 * caught (rescued) just above it. Orange→violet gradient stroke with a soft glow and a pulsing
 * rescue marker. All colours are ui_context.md tokens; the draw-in respects reduced motion.
 */
export function LifelineArt() {
  const curve =
    "M20,112 C80,120 120,146 170,172 C214,198 256,242 300,258 C326,249 350,205 386,164 C426,120 486,108 540,98";
  return (
    <svg
      viewBox="0 0 560 360"
      role="img"
      aria-label="A loan's health falls toward the 110% liquidation line and is rescued back up"
      className="h-auto w-full"
    >
      <defs>
        <linearGradient id="ll-stroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" style={{ stopColor: "var(--accent)" }} />
          <stop offset="55%" style={{ stopColor: "var(--accent)" }} />
          <stop offset="100%" style={{ stopColor: "var(--lien)" }} />
        </linearGradient>
        <linearGradient id="ll-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: "var(--accent)", stopOpacity: 0.16 }} />
          <stop offset="100%" style={{ stopColor: "var(--accent)", stopOpacity: 0 }} />
        </linearGradient>
        <filter id="ll-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* liquidation threshold */}
      <line
        x1="20"
        y1="282"
        x2="540"
        y2="282"
        style={{ stroke: "var(--danger)", strokeOpacity: 0.5 }}
        strokeWidth="1.5"
        strokeDasharray="5 6"
      />
      <text x="20" y="302" style={{ fill: "var(--danger)", fillOpacity: 0.85 }} fontSize="12" className="font-mono">
        Liquidation · 110.0%
      </text>

      {/* area under the curve */}
      <path d={`${curve} L540,360 L20,360 Z`} fill="url(#ll-fill)" />

      {/* the lifeline */}
      <path
        className="lifeline-path"
        pathLength={100}
        d={curve}
        fill="none"
        stroke="url(#ll-stroke)"
        strokeWidth="3"
        strokeLinecap="round"
        filter="url(#ll-glow)"
      />

      {/* rescue marker at the dip */}
      <circle className="lifeline-pulse" cx="300" cy="258" r="7" style={{ fill: "var(--accent)", fillOpacity: 0.45 }} />
      <circle cx="300" cy="258" r="4.5" style={{ fill: "var(--accent)" }} />
    </svg>
  );
}
