import {
  AudioLines,
  FileText,
  FileVideo,
  Film,
  Image as ImageIcon
} from "lucide-react";
import { useTranslations } from "@/i18n/context";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { LibraryAsset } from "@/lib/library";

type StatusVariant = "success" | "warning" | "destructive" | "secondary";
type Translate = (key: string, values?: Record<string, number | string>) => string;

type AssetSection = {
  key: string;
  title: string;
  assets: LibraryAsset[];
};

const statusBadge: Record<string, StatusVariant> = {
  READY: "success",
  GENERATING: "warning",
  FAILED: "destructive"
};

const typeIcon: Record<string, typeof ImageIcon> = {
  STORYBOARD_FRAME: ImageIcon,
  VIDEO_SEGMENT: FileVideo,
  FINAL_VIDEO: Film,
  AUDIO_TRACK: AudioLines,
  TRANSCRIPT: FileText,
  REWRITTEN_SCRIPT: FileText,
  SUBTITLE: FileText,
  SOURCE_VIDEO: FileVideo
};

export function AssetSections({
  assets,
  emptyText,
  signingError,
  signingErrorLabel,
  statusLabels,
  showTaskTitle = true
}: {
  assets: LibraryAsset[];
  emptyText: string;
  signingError: string | null;
  signingErrorLabel: string;
  statusLabels: Record<string, string>;
  showTaskTitle?: boolean;
}) {
  const t = useTranslations("assets");
  const sections = getSections(assets, t);

  if (assets.length === 0) return <EmptyAssets text={emptyText} />;

  return (
    <div className="flex flex-col gap-5">
      {signingError ? (
        <p className="rounded-md border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          {signingErrorLabel}: {signingError}
        </p>
      ) : null}
      {sections.map((section) => (
        <AssetGroup
          key={section.key}
          section={section}
          viewAllLabel={t("viewAll", { count: section.assets.length })}
          statusLabels={statusLabels}
          showTaskTitle={showTaskTitle}
        />
      ))}
    </div>
  );
}

function AssetGroup({
  section,
  viewAllLabel,
  statusLabels,
  showTaskTitle
}: {
  section: AssetSection;
  viewAllLabel: string;
  statusLabels: Record<string, string>;
  showTaskTitle: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{section.title}</h2>
        <Badge variant="outline">{viewAllLabel}</Badge>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
        {section.assets.map((asset) => (
          <AssetCard
            key={asset.id}
            asset={asset}
            statusLabels={statusLabels}
            showTaskTitle={showTaskTitle}
          />
        ))}
      </div>
    </section>
  );
}

function AssetCard({
  asset,
  statusLabels,
  showTaskTitle
}: {
  asset: LibraryAsset;
  statusLabels: Record<string, string>;
  showTaskTitle: boolean;
}) {
  const t = useTranslations("assets");

  return (
    <Card className="overflow-hidden">
      <Preview asset={asset} />
      <CardContent className="flex flex-col gap-3 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate text-sm font-semibold">{assetTitle(asset)}</span>
            {showTaskTitle ? (
              <span className="text-xs text-muted-foreground">{asset.taskTitle}</span>
            ) : null}
          </div>
          <Badge variant={statusBadge[asset.status] ?? "secondary"}>
            {statusLabels[asset.status] ?? asset.status}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground">{translateAssetType(t, asset.type)}</span>
      </CardContent>
    </Card>
  );
}

function Preview({ asset }: { asset: LibraryAsset }) {
  if (asset.url && isImage(asset)) return <ImagePreview asset={asset} />;
  if (asset.url && isVideo(asset)) {
    return <video src={asset.url} controls className="aspect-video w-full bg-black object-cover" />;
  }
  if (asset.url && isAudio(asset)) return <AudioPreview asset={asset} />;
  return <Placeholder asset={asset} />;
}

function ImagePreview({ asset }: { asset: LibraryAsset }) {
  return (
    <div className="aspect-video overflow-hidden bg-secondary">
      <img src={asset.url ?? ""} alt={asset.taskTitle} className="size-full object-cover" />
    </div>
  );
}

function AudioPreview({ asset }: { asset: LibraryAsset }) {
  return (
    <div className="flex aspect-video items-center justify-center bg-[#07111f] p-4">
      <audio src={asset.url ?? ""} controls className="w-full" />
    </div>
  );
}

function Placeholder({ asset }: { asset: LibraryAsset }) {
  const Icon = typeIcon[asset.type] ?? FileText;

  return (
    <div className="flex aspect-video items-center justify-center bg-gradient-to-br from-blue-500/[0.12] to-violet-500/[0.08]">
      <Icon className="size-9 text-blue-200" />
    </div>
  );
}

function EmptyAssets({ text }: { text: string }) {
  return (
    <Card>
      <CardContent className="p-5 text-sm text-muted-foreground">{text}</CardContent>
    </Card>
  );
}

function getSections(assets: LibraryAsset[], t: Translate) {
  return [
    { key: "images", title: t("sections.images"), assets: assets.filter(isImage) },
    { key: "audio", title: t("sections.audio"), assets: assets.filter(isAudio) },
    { key: "videos", title: t("sections.videos"), assets: assets.filter(isVideo) },
    { key: "documents", title: t("sections.documents"), assets: assets.filter(isDocument) }
  ].filter((section) => section.assets.length > 0);
}

function translateAssetType(t: Translate, type: string) {
  return t(`types.${type}`);
}

function assetTitle(asset: LibraryAsset) {
  const parts = asset.storageKey.split(/[/\\]/);
  const fileName = parts[parts.length - 1];
  if (fileName) return fileName;
  if (asset.sceneIndex != null) return `scene_${asset.sceneIndex + 1}`;
  return asset.type.toLowerCase();
}

function isImage(asset: LibraryAsset) {
  return asset.type === "STORYBOARD_FRAME" || Boolean(asset.mimeType?.startsWith("image/"));
}

function isVideo(asset: LibraryAsset) {
  return (
    asset.type === "VIDEO_SEGMENT" ||
    asset.type === "FINAL_VIDEO" ||
    asset.type === "SOURCE_VIDEO" ||
    Boolean(asset.mimeType?.startsWith("video/"))
  );
}

function isAudio(asset: LibraryAsset) {
  return asset.type === "AUDIO_TRACK" || Boolean(asset.mimeType?.startsWith("audio/"));
}

function isDocument(asset: LibraryAsset) {
  return !isImage(asset) && !isVideo(asset) && !isAudio(asset);
}