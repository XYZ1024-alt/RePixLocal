import type { Dispatch, SetStateAction } from "react";
import type { TaskConfig } from "@/lib/task-schema";
import type { WizardDraft } from "@/types";

export type WizardPhase = "idle" | "creating" | "submitting";
export type WizardStep = WizardDraft["step"];
export type FieldErrors = Record<string, string>;
export type WizardTranslator = (
  key: string,
  values?: Record<string, string | number>
) => string;
export type DraftChangeHandler = Dispatch<SetStateAction<WizardDraft>>;
export type ConfigChangeHandler = <K extends keyof TaskConfig>(
  key: K,
  value: TaskConfig[K]
) => void;

export type SourcePickerProps = {
  draft: WizardDraft;
  busy: boolean;
  errors: FieldErrors;
  onChange: DraftChangeHandler;
  onError: (message: string | null) => void;
};
