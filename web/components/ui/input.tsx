import * as React from "react";
import { cn } from "@/lib/utils";

// shadcn/ui Input, themed with ui_context.md tokens. Numeric amounts use the mono font.
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-[var(--radius)] border border-border bg-surface-2 px-3 font-mono text-sm tabular-nums text-text placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
