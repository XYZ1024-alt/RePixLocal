import { useEffect, useState } from "react";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import type { ProviderModels } from "./types";

type ModelFieldProps = {
  id: string;
  label: string;
  value: string;
  models: ProviderModels;
  placeholder: string;
  selectPlaceholder: string;
  useCustomModelLabel: string;
  useProviderModelsLabel: string;
  onChange: (value: string) => void;
};

export function ModelField(props: ModelFieldProps) {
  const [custom, setCustom] = useState(false);

  useEffect(() => {
    setCustom(!props.models?.length);
  }, [props.models]);

  return (
    <FormField label={props.label} htmlFor={props.id} required={!props.value}>
      {props.models && !custom ? (
        <Select value={props.value} onValueChange={props.onChange}>
          <SelectTrigger id={props.id}>
            <SelectValue placeholder={props.selectPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {props.models.map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                {entry.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={props.id}
          value={props.value}
          placeholder={props.placeholder}
          onChange={(event) => props.onChange(event.target.value)}
        />
      )}
      {props.models ? (
        <button
          type="button"
          onClick={() => setCustom((current) => !current)}
          className="mt-1 text-xs text-muted-foreground transition-colors duration-control hover:text-foreground"
        >
          {custom ? props.useProviderModelsLabel : props.useCustomModelLabel}
        </button>
      ) : null}
    </FormField>
  );
}
