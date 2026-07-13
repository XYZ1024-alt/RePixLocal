import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useTranslations } from "@/i18n/context";
import { ImagePicker } from "./ImagePicker";
import { ModePicker } from "./ModePicker";
import type { DraftChangeHandler, FieldErrors } from "./types";
import { VideoPicker } from "./VideoPicker";
import { WizardField } from "./WizardField";
import type { WizardDraft } from "@/types";

export function SourceStep({
  draft,
  busy,
  errors,
  onChange,
  onError
}: {
  draft: WizardDraft;
  busy: boolean;
  errors: FieldErrors;
  onChange: DraftChangeHandler;
  onError: (message: string | null) => void;
}) {
  const t = useTranslations("wizard");
  const isImageTask = draft.config.taskType === "image_to_video";
  return (
    <Card>
      <CardHeader><CardTitle>{t("sourceStepTitle")}</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <ModePicker
          value={draft.config.taskType}
          busy={busy}
          onChange={(taskType) =>
            onChange((current) => ({
              ...current,
              config: { ...current.config, taskType }
            }))
          }
        />
        <div className="source-mode-switch">
          <div className="source-mode-content" data-active={!isImageTask} aria-hidden={isImageTask}>
            <VideoPicker draft={draft} busy={busy} errors={isImageTask ? {} : errors} onChange={onChange} onError={onError} />
          </div>
          <div className="source-mode-content" data-active={isImageTask} aria-hidden={!isImageTask}>
            <ImagePicker draft={draft} busy={busy} errors={isImageTask ? errors : {}} onChange={onChange} onError={onError} />
          </div>
        </div>
        <WizardField label={t("taskTitle")} error={errors.title}>
          <Input
            aria-invalid={Boolean(errors.title)}
            value={draft.title}
            onChange={(event) =>
              onChange((current) => ({ ...current, title: event.target.value }))
            }
            placeholder={t("taskTitlePlaceholder")}
            disabled={busy}
            data-field-error={Boolean(errors.title)}
          />
        </WizardField>
      </CardContent>
    </Card>
  );
}
