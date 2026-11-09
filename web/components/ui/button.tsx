import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { Spinner } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

// shadcn/ui Button: Tier-1 pills (rounded-full), daylight palette.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg active:translate-y-px disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-accent text-white shadow-[0_1px_2px_rgba(15,17,21,0.12)] hover:bg-[#e2860e]",
        secondary: "bg-[#0f1115] text-white hover:bg-[#1c2027]",
        outline: "border border-border-strong bg-white text-text hover:border-[#c4c9d1] hover:bg-surface-2",
        ghost: "text-text hover:bg-surface-2",
      },
      size: { default: "h-11 px-5", sm: "h-9 px-4", lg: "h-12 px-6 text-[0.95rem]" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** In-flight action: shows a spinner, keeps the label, disables the button. */
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    if (asChild) {
      return (
        <Slot className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props}>
          {children}
        </Slot>
      );
    }
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Spinner className="-ml-0.5 h-3.5 w-3.5" /> : null}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
