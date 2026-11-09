import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

// Minimal inline icon set (no icon dependency). 16px grid, 1.75 stroke, currentColor, round joins.
type IconProps = SVGProps<SVGSVGElement>;

function Base({ className, children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={cn("h-4 w-4 shrink-0", className)}
      {...props}
    >
      {children}
    </svg>
  );
}

export function ArrowRight(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3 8h10" />
      <path d="M9 4l4 4-4 4" />
    </Base>
  );
}

export function ArrowLeft(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M13 8H3" />
      <path d="M7 4L3 8l4 4" />
    </Base>
  );
}

/** External / outbound link. */
export function ArrowUpRight(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5 11l6-6" />
      <path d="M6 5h5v5" />
    </Base>
  );
}

/** Three-line menu toggle (mobile navigation). */
export function Menu(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M2.5 4.5h11" />
      <path d="M2.5 8h11" />
      <path d="M2.5 11.5h11" />
    </Base>
  );
}

export function Close(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 4l8 8" />
      <path d="M12 4l-8 8" />
    </Base>
  );
}

export function Check(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3.5 8.5l3 3 6-7" />
    </Base>
  );
}

export function AlertCircle(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3.5" />
      <path d="M8 11h.01" />
    </Base>
  );
}

export function Lock(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
    </Base>
  );
}

/** Indeterminate progress ring for in-flight actions. */
export function Spinner({ className, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      focusable="false"
      className={cn("h-4 w-4 shrink-0 animate-spin", className)}
      {...props}
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity={0.22} strokeWidth={2} />
      <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}
