import * as React from "react";
import { cn } from "@/lib/utils";

type ProgressProps = Omit<React.ComponentProps<"div">, "children"> & {
  value?: number;
  label?: string;
};

function clampProgress(value: number) {
  return Math.min(100, Math.max(0, value));
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, label, ...props }, ref) => {
    const normalized = value == null ? undefined : clampProgress(value);
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={normalized}
        aria-label={label}
        className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-inset", className)}
        {...props}
      >
        <div
          className={cn(
            "motion-progress h-full origin-left rounded-full bg-brand transition-[transform,opacity] [transition-duration:var(--motion-panel)] ease-fluid-out",
            normalized == null && "opacity-45"
          )}
          style={{ transform: `scaleX(${normalized == null ? 1 : normalized / 100})` }}
        />
      </div>
    );
  }
);
Progress.displayName = "Progress";

export { Progress };
export type { ProgressProps };
