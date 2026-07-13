import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex min-h-5 w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-semibold transition-colors [transition-duration:var(--motion-control)]",
  {
    variants: {
      variant: {
        default: "border-brand/30 bg-brand-muted text-accent-foreground",
        secondary: "border-border bg-secondary text-secondary-foreground",
        destructive: "border-destructive/25 bg-destructive-muted text-destructive-foreground",
        outline: "border-border bg-transparent text-muted-foreground",
        success: "border-success/25 bg-success-muted text-success-foreground",
        warning: "border-warning/25 bg-warning-muted text-warning-foreground"
      }
    },
    defaultVariants: { variant: "default" }
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
