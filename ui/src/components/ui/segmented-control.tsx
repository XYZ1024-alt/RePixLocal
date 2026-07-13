import { cn } from "@/lib/utils";
import { handleRovingRadioKeyDown } from "@/lib/roving-radio";

type SegmentOption<Value extends string> = {
  value: Value;
  label: string;
  count?: number;
  disabled?: boolean;
};

type SegmentedControlProps<Value extends string> = {
  value: Value;
  onValueChange: (value: Value) => void;
  options: readonly SegmentOption<Value>[];
  "aria-label"?: string;
  className?: string;
};

function SegmentedControl<Value extends string>({
  value,
  onValueChange,
  options,
  "aria-label": ariaLabel,
  className
}: SegmentedControlProps<Value>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("inline-flex min-h-10 items-center gap-1 rounded-lg border border-border bg-surface-inset p-1", className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          disabled={option.disabled}
          onClick={() => onValueChange(option.value)}
          onKeyDown={handleRovingRadioKeyDown}
          className={cn(
            "flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold text-muted-foreground transition-[background-color,color,transform] [transition-duration:var(--motion-control)] ease-fluid-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45 motion-safe:active:scale-[0.97] active:[transition-duration:var(--motion-press)]",
            option.value === value && "bg-surface text-foreground shadow-sm"
          )}
        >
          <span>{option.label}</span>
          {option.count != null ? (
            <span className="min-w-4 rounded-full bg-muted px-1 text-[10px] tabular-nums text-muted-foreground">
              {option.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export { SegmentedControl };
export type { SegmentedControlProps, SegmentOption };
