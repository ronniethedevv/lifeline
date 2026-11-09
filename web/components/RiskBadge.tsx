import { RISK_META, type RiskState } from "@/lib/risk";
import { cn } from "@/lib/utils";

const TOKEN_CLASS: Record<(typeof RISK_META)[RiskState]["token"], string> = {
  safe: "bg-safe/10 border-safe/25 text-safe",
  watch: "bg-watch/10 border-watch/25 text-watch",
  danger: "bg-danger/10 border-danger/25 text-danger",
  lien: "bg-lien/10 border-lien/25 text-lien",
  "text-muted": "bg-surface-2 border-border text-text-muted",
};

/** Loan-health pill: a coloured dot plus the state label (never colour alone, ui_context.md). */
export function RiskBadge({ state, className }: { state: RiskState; className?: string }) {
  const { label, token } = RISK_META[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        TOKEN_CLASS[token],
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}
