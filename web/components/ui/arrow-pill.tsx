import Link from "next/link";
import * as React from "react";
import { ArrowRight } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary";

const BASE =
  "group inline-flex items-center gap-2 rounded-full pl-4 pr-1.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-50";

const SHELL: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-[#e2860e] shadow-[0_1px_2px_rgba(15,17,21,0.14)]",
  secondary: "bg-[#0f1115] text-white hover:bg-[#1c2027]",
};

const BADGE: Record<Variant, string> = {
  primary: "bg-white/20 text-white",
  secondary: "bg-white text-[#0f1115]",
};

/** Label on the left, a 24px circular arrow badge on the right that nudges 2px on hover. */
function Inner({ children, variant }: { children: React.ReactNode; variant: Variant }) {
  return (
    <>
      <span className="pl-0.5">{children}</span>
      <span
        aria-hidden
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-full transition-transform duration-200 ease-out group-hover:translate-x-0.5",
          BADGE[variant],
        )}
      >
        <ArrowRight className="h-3.5 w-3.5" />
      </span>
    </>
  );
}

export interface ArrowPillProps {
  children: React.ReactNode;
  variant?: Variant;
  className?: string;
  href?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  type?: "button" | "submit";
  disabled?: boolean;
}

export function ArrowPill({ children, variant = "primary", className, href, onClick, type = "button", disabled }: ArrowPillProps) {
  const cls = cn(BASE, SHELL[variant], className);
  if (href !== undefined) {
    return (
      <Link href={href} className={cls}>
        <Inner variant={variant}>{children}</Inner>
      </Link>
    );
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cls}>
      <Inner variant={variant}>{children}</Inner>
    </button>
  );
}
