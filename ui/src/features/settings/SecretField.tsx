import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SecretFieldProps = {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  revealLabel: string;
  hideLabel: string;
  hint?: React.ReactNode;
  onChange: (value: string) => void;
};

export function SecretField(props: SecretFieldProps) {
  const [visible, setVisible] = useState(false);
  const label = visible ? props.hideLabel : props.revealLabel;
  const hintId = props.hint ? `${props.id}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      <div className="relative">
        <Input
          id={props.id}
          type={visible ? "text" : "password"}
          value={props.value}
          placeholder={props.placeholder}
          onChange={(event) => props.onChange(event.target.value)}
          className="pr-11"
          autoComplete="off"
          aria-describedby={hintId}
        />
        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          label={label}
          tooltip={label}
          onClick={() => setVisible((current) => !current)}
          className="absolute right-1 top-1/2 -translate-y-1/2"
        >
          {visible ? <EyeOff /> : <Eye />}
        </IconButton>
      </div>
      {props.hint ? <p id={hintId} className="text-xs text-muted-foreground">{props.hint}</p> : null}
    </div>
  );
}
