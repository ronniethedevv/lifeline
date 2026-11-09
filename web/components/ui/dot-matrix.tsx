/** Small pixel-grid micro-icon in muted grey with one square highlighted in Bitcoin orange.
 *  Sits above major sections / feature rows as a quiet accent marker. */
export function DotMatrix({
  size = 4,
  highlight = 5,
  className,
}: {
  size?: number;
  highlight?: number;
  className?: string;
}) {
  const square = 3;
  const gap = 2.5;
  const step = square + gap;
  const extent = size * step - gap;
  return (
    <svg width={extent} height={extent} viewBox={`0 0 ${extent} ${extent}`} className={className} aria-hidden role="presentation">
      {Array.from({ length: size * size }, (_, i) => (
        <rect
          key={i}
          x={(i % size) * step}
          y={Math.floor(i / size) * step}
          width={square}
          height={square}
          rx={0.75}
          fill={i === highlight ? "var(--accent)" : "#9ca3af"}
        />
      ))}
    </svg>
  );
}
