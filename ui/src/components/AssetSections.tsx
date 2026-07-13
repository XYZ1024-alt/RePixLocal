import {
  AudioLines,
  FileText,
  FileVideo,
  Film,
  Image as ImageIcon,
  Inbox,
  FolderOpen
} from "lucide-react";
import { useTranslations } from "@/i18n/context";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { MediaCard } from "@/components/ui/media-card";
import type { LibraryAsset } from "@/lib/library";

type StatusVariant = "success" | "warning" | "destructive" | "secondary" | "default";
type Translate = (key: string, values?: Record<string, number | string>) => string;

type AssetSection = {
  key: string;
  title: string;
  assets: LibraryAsset[];
};

const statusBadge: Record<string, StatusVariant> = {
  READY: "success",
  GENERATING: "default",
  FAILED: "destructive"
};

const typeIcon: Record<string, typeof ImageIcon> = {
  STORYBOARD_FRAME: ImageIcon,
  VIDEO_SEGMENT: FileVideo,
  FINAL_VIDEO: Film,
  AUDIO_TRACK: AudioLines,
  TRANSCRIPT: FileText,
  REWRITTEN_SCRIPT: FileText,
  SOURCE_VIDEO: FileVideo
};

export function AssetSections({
  assets,
  emptyText,
  signingError,
  signingErrorLabel,
  statusLabels,
  showTaskTitle = true,
  onRevealAsset
}: {
  assets: LibraryAsset[];
  emptyText: string;
  signingError: string | null;
  signingErrorLabel: string;
  statusLabels: Record<string, string>;
  showTaskTitle?: boolean;
  onRevealAsset?: (path: string) => void;
}) {
  const t = useTranslations("assets");
  const sections = getSections(assets, t);

  if (assets.length === 0) return <EmptyAssets text={emptyText} />;

  return (
    <div className="flex flex-col gap-5">
      {signingError ? (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
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
          onRevealAsset={onRevealAsset}
        />
      ))}
    </div>
  );
}

function AssetGroup({
  section,
  viewAllLabel,
  statusLabels,
  showTaskTitle,
  onRevealAsset
}: {
  section: AssetSection;
  viewAllLabel: string;
  statusLabels: Record<string, string>;
  showTaskTitle: boolean;
  onRevealAsset?: (path: string) => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <span className="h-2 w-2 rounded-full bg-brand" />
          {section.title}
        </h2>
        <Badge variant="outline">
          {viewAllLabel}
        </Badge>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
        {section.assets.map((asset) => (
          <AssetCard
            key={asset.id}
            asset={asset}
            statusLabels={statusLabels}
            showTaskTitle={showTaskTitle}
            onRevealAsset={onRevealAsset}
          />
        ))}
      </div>
    </section>
  );
}

function AssetCard({
  asset,
  statusLabels,
  showTaskTitle,
  onRevealAsset
}: {
  asset: LibraryAsset;
  statusLabels: Record<string, string>;
  showTaskTitle: boolean;
  onRevealAsset?: (path: string) => void;
}) {
  const t = useTranslations("assets");

  return (
    <MediaCard
      title={assetTitle(asset)}
      preview={<Preview asset={asset} />}
      interactive={Boolean(onRevealAsset)}
      meta={
        <div className="flex flex-col gap-1">
          {showTaskTitle ? <span>{asset.taskTitle}</span> : null}
          <span>{translateAssetType(t, asset.type)}</span>
        </div>
      }
      status={
        <Badge variant={statusBadge[asset.status] ?? "secondary"}>
          {statusLabels[asset.status] ?? asset.status}
        </Badge>
      }
      actions={
        onRevealAsset ? (
          <div className="flex w-full justify-end">
            <IconButton
              type="button"
              variant="ghost"
              className="size-8"
              tooltip={t("openInFolder")}
              onClick={() => onRevealAsset(asset.storageKey)}
            >
              <FolderOpen aria-hidden="true" />
            </IconButton>
          </div>
        ) : undefined
      }
    />
  );
}

function Preview({ asset }: { asset: LibraryAsset }) {
  if (asset.url && isImage(asset)) return <ImagePreview asset={asset} />;
  if (asset.url && isVideo(asset)) {
    return (
      <div className="size-full overflow-hidden bg-black">
        <video
          src={asset.url}
          controls
          className="size-full object-cover"
        />
      </div>
    );
  }
  if (asset.url && isAudio(asset)) return <AudioPreview asset={asset} />;
  return <Placeholder asset={asset} />;
}

function ImagePreview({ asset }: { asset: LibraryAsset }) {
  return (
    <img
      src={asset.url ?? ""}
      alt={asset.taskTitle}
      className="size-full object-cover"
    />
  );
}

function AudioPreview({ asset }: { asset: LibraryAsset }) {
  return (
    <div className="flex size-full items-center justify-center bg-surface-inset p-4">
      <audio src={asset.url ?? ""} controls className="w-full" />
    </div>
  );
}

function Placeholder({ asset }: { asset: LibraryAsset }) {
  const Icon = typeIcon[asset.type] ?? FileText;

  return (
    <div className="flex size-full items-center justify-center bg-surface-inset">
      <Icon className="size-9 text-muted-foreground" />
    </div>
  );
}

function EmptyAssets({ text }: { text: string }) {
  return (
    <Card>
      <EmptyState icon={Inbox} description={text} />
    </Card>
  );
}

function getSections(assets: LibraryAsset[], t: Translate) {
  const finals = assets.filter(isFinalVideo);
  const segments = assets.filter(isSegmentVideo);
  const sources = assets.filter(isSourceVideo);
  return [
    { key: "final", title: t("sections.final"), assets: finals },
    {
      key: "videos",
      title: t("sections.videos"),
      assets: [...segments, ...sources]
    },
    { key: "images", title: t("sections.images"), assets: assets.filter(isImage) },
    { key: "audio", title: t("sections.audio"), assets: assets.filter(isAudio) },
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

function isFinalVideo(asset: LibraryAsset) {
  return asset.type === "FINAL_VIDEO";
}

function isSegmentVideo(asset: LibraryAsset) {
  return asset.type === "VIDEO_SEGMENT";
}

function isSourceVideo(asset: LibraryAsset) {
  return asset.type === "SOURCE_VIDEO";
}

function isVideo(asset: LibraryAsset) {
  return isFinalVideo(asset) || isSegmentVideo(asset) || isSourceVideo(asset);
}

function isAudio(asset: LibraryAsset) {
  return asset.type === "AUDIO_TRACK" || Boolean(asset.mimeType?.startsWith("audio/"));
}

function isDocument(asset: LibraryAsset) {
  return !isImage(asset) && !isVideo(asset) && !isAudio(asset);
}
