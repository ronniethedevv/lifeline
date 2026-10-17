import { RISK_META, type RiskState } from "@/lib/risk";
import { cn } from "@/lib/utils";

const TOKEN_CLASS: Record<(typeof RISK_META)[RiskState]["token"], string> = {
  safe: "bg-safe/15 text-safe",
  watch: "bg-watch/15 text-watch",
  danger: "bg-danger/15 text-danger",
  lien: "bg-lien/15 text-lien",
  "text-muted": "bg-surface-2 text-text-muted",
};

/** Loan-health pill: a coloured dot plus the state label (never colour alone, ui_context.md). */
export function RiskBadge({ state, className }: { state: RiskState; className?: string }) {
  const { label, token } = RISK_META[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        TOKEN_CLASS[token],
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}
