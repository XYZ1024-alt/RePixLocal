import { Check, Images, Wand2 } from "lucide-react";
import { useTranslations } from "@/i18n/context";
import { TASK_TYPES, type TaskConfig } from "@/lib/task-schema";
import { cn } from "@/lib/utils";
import { handleRovingRadioKeyDown } from "@/lib/roving-radio";

export function ModePicker({
  value,
  busy,
  onChange
}: {
  value: TaskConfig["taskType"];
  busy: boolean;
  onChange: (value: TaskConfig["taskType"]) => void;
}) {
  const t = useTranslations("wizard");
  return (
    <div role="radiogroup" aria-label={t("taskMode")} className="grid gap-3 sm:grid-cols-2">
      {TASK_TYPES.map((taskType) => {
        const selected = value === taskType;
        const Icon = taskType === "replicate" ? Wand2 : Images;
        return (
          <button
            key={taskType}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={busy}
            onClick={() => onChange(taskType)}
            onKeyDown={handleRovingRadioKeyDown}
            className={cn(
              "relative flex min-h-28 flex-col gap-3 rounded-lg border p-4 text-left transition-[border-color,background-color,color] duration-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "border-brand bg-brand/8 text-foreground"
                : "border-border bg-surface-inset text-muted-foreground hover:border-border-strong"
            )}
          >
            <Icon className={cn("size-5", selected && "text-brand")} />
            <span>
              <strong className="block text-sm text-foreground">
                {t(`options.taskType.${taskType}`)}
              </strong>
              <span className="mt-1 block text-xs leading-5">
                {t(`options.taskTypeDesc.${taskType}`)}
              </span>
            </span>
            {selected ? <Check className="absolute right-3 top-3 size-4 text-brand" /> : null}
          </button>
        );
      })}
    </div>
  );
}
