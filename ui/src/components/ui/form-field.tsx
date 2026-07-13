import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type FieldControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

type FormFieldProps = {
  label: React.ReactNode;
  children: React.ReactNode;
  htmlFor?: string;
  description?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  className?: string;
};

function FormField({
  label,
  children,
  htmlFor,
  description,
  error,
  required,
  className
}: FormFieldProps) {
  const generatedId = React.useId();
  const childNodes = React.Children.toArray(children);
  const firstChild = childNodes[0];
  if (!React.isValidElement<FieldControlProps>(firstChild)) {
    throw new Error("FormField requires a form control as its first child");
  }
  const fieldId = htmlFor ?? firstChild.props.id ?? generatedId;
  const descriptionId = description ? `${fieldId}-description` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;
  const control = React.cloneElement(firstChild, {
    id: fieldId,
    "aria-describedby": describedBy,
    "aria-invalid": Boolean(error)
  });

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={fieldId}>
        {label}
        {required ? <span className="ml-1 text-destructive" aria-hidden="true">*</span> : null}
      </Label>
      {control}
      {childNodes.slice(1)}
      {description ? <p id={descriptionId} className="text-xs text-muted-foreground">{description}</p> : null}
      {error ? <p id={errorId} className="text-xs font-medium text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}

export { FormField };
export type { FormFieldProps };
