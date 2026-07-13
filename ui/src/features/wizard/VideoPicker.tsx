import { UploadCloud } from "lucide-react";
import { useTranslations } from "@/i18n/context";
import { useServices } from "@/services/context";
import type { SourcePickerProps } from "./types";
import { formatSize, stripExtension, validatePickedFile } from "./wizard-model";
import { WizardField } from "./WizardField";

export function VideoPicker({ draft, busy, errors, onChange, onError }: SourcePickerProps) {
  const t = useTranslations("wizard");
  const { pickVideoFile } = useServices();

  async function pick() {
    const file = await pickVideoFile();
    if (!file) return;
    const error = validatePickedFile(file, t);
    if (error) {
      onError(error);
      return;
    }
    onError(null);
    onChange((current) => ({
      ...current,
      file,
      title: current.title || stripExtension(file.name)
    }));
  }

  return (
    <WizardField label={t("sourceVideo")} error={errors.source}>
      <button
        type="button"
        aria-label={t("chooseVideo")}
        aria-invalid={Boolean(errors.source)}
        disabled={busy}
        onClick={() =>
          void pick().catch((error) =>
            onError(error instanceof Error ? error.message : String(error))
          )
        }
        data-field-error={Boolean(errors.source)}
        className="flex w-full items-center gap-4 rounded-lg border border-dashed border-border-strong bg-surface-inset p-5 text-left transition-[border-color,background-color] duration-control hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-brand/10 text-brand">
          <UploadCloud />
        </span>
        <span>
          <strong className="block text-sm">{draft.file?.name ?? t("chooseVideo")}</strong>
          <span className="mt-1 block text-xs text-muted-foreground">
            {draft.file ? formatSize(draft.file.size_bytes) : t("sourceVideoDesc")}
          </span>
        </span>
      </button>
    </WizardField>
  );
}
