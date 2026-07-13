import * as React from "react";
import { cn } from "@/lib/utils";

type MediaCardProps = React.ComponentProps<"article"> & {
  title: React.ReactNode;
  preview: React.ReactNode;
  meta?: React.ReactNode;
  status?: React.ReactNode;
  actions?: React.ReactNode;
  interactive?: boolean;
};

function MediaCard({
  title,
  preview,
  meta,
  status,
  actions,
  interactive,
  className,
  ...props
}: MediaCardProps) {
  return (
    <article
      className={cn(
        "group overflow-hidden rounded-lg border border-border bg-surface",
        interactive && "interactive-surface",
        className
      )}
      {...props}
    >
      <div className="aspect-video overflow-hidden bg-surface-inset">{preview}</div>
      <div className="flex min-w-0 flex-col gap-3 p-3">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
            {meta ? <div className="mt-1 text-xs text-muted-foreground">{meta}</div> : null}
          </div>
          {status}
        </div>
        {actions ? <div className="flex items-center gap-2 border-t border-border pt-3">{actions}</div> : null}
      </div>
    </article>
  );
}

export { MediaCard };
export type { MediaCardProps };
