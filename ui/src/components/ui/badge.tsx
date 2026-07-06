import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border px-2 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-cyan-400/30 bg-cyan-400/15 text-cyan-200",
        secondary: "border-zinc-700 bg-zinc-900 text-zinc-200",
        destructive: "border-red-900/50 bg-red-950/60 text-red-200",
        outline: "border-zinc-700 bg-transparent text-zinc-300",
        success: "border-zinc-700 bg-zinc-900 text-zinc-200",
        warning: "border-zinc-700 bg-zinc-900 text-zinc-200"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
