import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WizardField } from "./WizardField";

export function WizardSelectField<T extends string>({
  label,
  error,
  value,
  options,
  disabled,
  onChange,
  getLabel
}: {
  label: string;
  error?: string;
  value: T;
  options: readonly T[];
  disabled?: boolean;
  onChange: (value: T) => void;
  getLabel: (value: T) => string;
}) {
  return (
    <WizardField label={label} error={error}>
      <Select value={value} disabled={disabled} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger
          aria-invalid={Boolean(error)}
          aria-label={label}
          data-field-error={Boolean(error)}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {getLabel(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </WizardField>
  );
}
