import * as React from "react";
import { cn } from "@/lib/utils";

// shadcn/ui Input, themed with ui_context.md tokens. Numeric amounts use the mono font.
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-sm border border-border bg-bg-subtle px-3 font-mono text-sm tabular-nums text-text placeholder:text-text-muted transition-colors focus-visible:border-accent focus-visible:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
