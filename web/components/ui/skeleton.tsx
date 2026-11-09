import { cn } from "@/lib/utils";

/** Loading placeholder for a value that hasn't arrived yet (instead of a dash or ellipsis). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block h-[0.85em] w-16 animate-pulse rounded-[6px] bg-surface-2 align-middle", className)}
    />
  );
}

/** Screen-reader text paired with a Skeleton so loading values are still announced. */
export function LoadingValue({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span className="inline-flex items-center">
      <Skeleton className={className} />
      <span className="sr-only">{label}</span>
    </span>
  );
}
