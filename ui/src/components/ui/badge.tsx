import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-semibold",
  {
    variants: {
      variant: {
        default: "border-blue-400/30 bg-blue-500/15 text-blue-200",
        secondary: "border-white/[0.08] bg-white/[0.06] text-slate-300",
        destructive: "border-red-400/30 bg-red-500/15 text-red-300",
        outline: "border-white/10 bg-white/[0.03] text-foreground",
        success: "border-emerald-400/25 bg-emerald-500/15 text-emerald-300",
        warning: "border-amber-400/25 bg-amber-500/15 text-amber-300"
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