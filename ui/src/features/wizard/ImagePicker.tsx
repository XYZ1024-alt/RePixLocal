import { Images } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { MAX_IMAGES } from "@/lib/task-schema";
import { useTranslations } from "@/i18n/context";
import { useServices } from "@/services/context";
import { ImageList } from "./ImageList";
import type { SourcePickerProps } from "./types";
import {
  removeDraftImage,
  stripExtension,
  validatePickedImages
} from "./wizard-model";
import { WizardField } from "./WizardField";

export function ImagePicker({ draft, busy, errors, onChange, onError }: SourcePickerProps) {
  const t = useTranslations("wizard");
  const { pickImageFiles } = useServices();

  async function pick() {
    const images = await pickImageFiles();
    const error = validatePickedImages(images, t);
    if (error) {
      onError(error);
      return;
    }
    onError(null);
    const selected = images.slice(0, MAX_IMAGES);
    onChange((current) => ({
      ...current,
      images: selected,
      title: current.title || stripExtension(selected[0]?.name ?? ""),
      config: {
        ...current.config,
        imagePaths: selected.map((image) => image.path),
        sceneCount: selected.length
      }
    }));
  }

  return (
    <div className="space-y-4">
      <ImageSelectButton busy={busy} error={errors.source} onPick={pick} onError={onError} />
      {draft.images.length ? (
        <ImageList
          images={draft.images}
          onRemove={(index) => onChange((current) => removeDraftImage(current, index))}
        />
      ) : null}
      <WizardField label={t("requirements")} error={errors.requirements}>
        <Textarea
          aria-invalid={Boolean(errors.requirements)}
          value={draft.config.requirements ?? ""}
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              config: { ...current.config, requirements: event.target.value }
            }))
          }
          placeholder={t("requirementsPlaceholder")}
          data-field-error={Boolean(errors.requirements)}
        />
      </WizardField>
    </div>
  );
}

function ImageSelectButton({
  busy,
  error,
  onPick,
  onError
}: {
  busy: boolean;
  error?: string;
  onPick: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const t = useTranslations("wizard");
  return (
    <WizardField label={t("sourceImages")} error={error}>
      <button
        type="button"
        aria-label={t("pickImages")}
        aria-invalid={Boolean(error)}
        disabled={busy}
        onClick={() =>
          void onPick().catch((pickError) =>
            onError(pickError instanceof Error ? pickError.message : String(pickError))
          )
        }
        data-field-error={Boolean(error)}
        className="flex w-full items-center gap-4 rounded-lg border border-dashed border-border-strong bg-surface-inset p-5 text-left transition-[border-color,background-color] duration-control hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-brand/10 text-brand">
          <Images />
        </span>
        <span>
          <strong className="block text-sm">{t("pickImages")}</strong>
          <span className="mt-1 block text-xs text-muted-foreground">{t("pickImagesDesc")}</span>
        </span>
      </button>
    </WizardField>
  );
}
