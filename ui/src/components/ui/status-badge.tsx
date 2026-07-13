import * as React from "react";
import { cn } from "@/lib/utils";

type StatusTone = "neutral" | "info" | "success" | "warning" | "error" | "running";

const toneClasses: Record<StatusTone, string> = {
  neutral: "border-border bg-secondary text-secondary-foreground",
  info: "border-info/25 bg-info-muted text-info-foreground",
  success: "border-success/25 bg-success-muted text-success-foreground",
  warning: "border-warning/25 bg-warning-muted text-warning-foreground",
  error: "border-destructive/25 bg-destructive-muted text-destructive-foreground",
  running: "border-brand/25 bg-brand-muted text-accent-foreground"
};

type StatusBadgeProps = React.ComponentProps<"span"> & {
  status?: StatusTone;
  showDot?: boolean;
};

function StatusBadge({ className, status = "neutral", showDot = true, children, ...props }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex min-h-5 w-fit items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-semibold",
        toneClasses[status],
        className
      )}
      {...props}
    >
      {showDot ? <span className="size-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export { StatusBadge };
export type { StatusBadgeProps, StatusTone };
