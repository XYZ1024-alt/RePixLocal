import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-5 py-10 text-center animate-fade-in",
        className
      )}
    >
      {Icon ? (
        <span className="flex size-12 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 text-zinc-500">
          <Icon className="size-6" />
        </span>
      ) : null}
      <div className="flex flex-col gap-1">
        {title ? <p className="text-sm font-semibold text-white">{title}</p> : null}
        {description ? <p className="max-w-xs text-xs leading-relaxed text-zinc-500">{description}</p> : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
