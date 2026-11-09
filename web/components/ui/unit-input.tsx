import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Numeric input with a fixed unit suffix (BTC, MUSD, %) inside the field. */
export const UnitInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { unit: string }
>(({ unit, className, ...props }, ref) => (
  <div className="relative">
    <Input ref={ref} inputMode="decimal" className={cn("pr-16", className)} {...props} />
    <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center font-mono text-xs text-text-muted">
      {unit}
    </span>
  </div>
));
UnitInput.displayName = "UnitInput";
