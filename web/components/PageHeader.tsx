import type { ReactNode } from "react";
import { DotMatrix } from "@/components/ui/dot-matrix";

/**
 * Consistent opening block for app views: dot-matrix marker, small-caps eyebrow, editorial title
 * (pass an accent <span> for the resolution phrase), optional description and right-aligned actions.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 pb-1">
      <div className="flex items-center gap-2.5">
        <DotMatrix />
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-muted">{eyebrow}</span>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-xl flex-col gap-2">
          <h1 className="text-3xl font-normal leading-[1.06] tracking-[-0.035em] sm:text-[2.125rem]">{title}</h1>
          {description ? <p className="text-sm leading-relaxed text-text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/** Small-caps label used above grouped content inside cards. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`text-[11px] font-medium uppercase tracking-[0.14em] text-text-muted ${className}`}>{children}</span>
  );
}
