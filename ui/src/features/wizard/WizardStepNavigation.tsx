import { Check } from "lucide-react";
import { useTranslations } from "@/i18n/context";
import { cn } from "@/lib/utils";
import type { WizardStep } from "./types";

export function WizardStepNavigation({
  step,
  onSelect
}: {
  step: WizardStep;
  onSelect: (step: WizardStep) => void;
}) {
  const t = useTranslations("wizard");
  const steps = ["source", "configure", "review"] as const;
  return (
    <ol
      className="grid grid-cols-3 overflow-hidden rounded-lg border border-border bg-surface"
      aria-label={t("steps.label")}
    >
      {steps.map((key, index) => {
        const value = index as WizardStep;
        const complete = value < step;
        return (
          <li key={key}>
            <button
              type="button"
              onClick={() => value <= step && onSelect(value)}
              className={cn(
                "flex h-12 w-full items-center justify-center gap-2 border-r border-border px-3 text-sm font-medium transition-colors duration-control last:border-r-0",
                value === step ? "bg-accent text-foreground" : "text-muted-foreground",
                value <= step && "hover:bg-accent/60 hover:text-foreground"
              )}
              aria-current={value === step ? "step" : undefined}
            >
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-full border text-xs",
                  complete && "border-success bg-success/10 text-success",
                  value === step && "border-brand text-brand"
                )}
              >
                {complete ? <Check className="size-3.5" /> : index + 1}
              </span>
              <span className="hidden sm:inline">{t(`steps.${key}`)}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
