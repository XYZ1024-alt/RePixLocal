import * as React from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

type AlertVariant = "info" | "success" | "warning" | "error";

const alertStyles: Record<AlertVariant, { className: string; icon: typeof Info }> = {
  info: { className: "border-info/25 bg-info-muted text-info-foreground", icon: Info },
  success: { className: "border-success/25 bg-success-muted text-success-foreground", icon: CheckCircle2 },
  warning: { className: "border-warning/25 bg-warning-muted text-warning-foreground", icon: TriangleAlert },
  error: { className: "border-destructive/25 bg-destructive-muted text-destructive-foreground", icon: AlertCircle }
};

type InlineAlertProps = Omit<React.ComponentProps<"div">, "title"> & {
  variant?: AlertVariant;
  title?: React.ReactNode;
  details?: React.ReactNode;
  detailsLabel?: React.ReactNode;
};

function InlineAlert({
  variant = "info",
  title,
  details,
  detailsLabel = "Details",
  className,
  children,
  ...props
}: InlineAlertProps) {
  const Icon = alertStyles[variant].icon;
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      aria-live="polite"
      className={cn("flex gap-3 rounded-lg border px-3 py-2.5 text-sm", alertStyles[variant].className, className)}
      {...props}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn("leading-relaxed", title && "mt-0.5")}>{children}</div> : null}
        {details ? (
          <details className="mt-2 border-t border-current/15 pt-2 text-xs">
            <summary className="cursor-pointer font-medium">{detailsLabel}</summary>
            <div className="mt-1 break-words font-mono leading-relaxed opacity-90">{details}</div>
          </details>
        ) : null}
      </div>
    </div>
  );
}

export { InlineAlert };
export type { InlineAlertProps, AlertVariant };
