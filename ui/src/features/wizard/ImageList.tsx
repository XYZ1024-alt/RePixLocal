import { FileVideo, Trash2 } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { useTranslations } from "@/i18n/context";
import type { PickedImageFile } from "@/types";

export function ImageList({
  images,
  onRemove
}: {
  images: PickedImageFile[];
  onRemove: (index: number) => void;
}) {
  const t = useTranslations("wizard");
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {images.map((image, index) => (
        <div key={image.path} className="flex items-center gap-3 rounded-md bg-surface-inset p-3">
          <FileVideo className="size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-sm">{image.name}</strong>
            <span className="text-xs text-muted-foreground">
              {t("sceneLabel", { index: index + 1 })}
            </span>
          </span>
          <IconButton
            type="button"
            variant="ghost"
            className="size-8"
            tooltip={t("removeImage", { index: index + 1 })}
            onClick={() => onRemove(index)}
          >
            <Trash2 />
          </IconButton>
        </div>
      ))}
    </div>
  );
}
