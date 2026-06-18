import { toAssetUrl } from "@/lib/asset-url";
import type { Asset } from "@/types";

export const ASSET_FILTERS = [
  { key: "all" },
  { key: "FINAL_VIDEO" },
  { key: "VIDEO_SEGMENT" },
  { key: "STORYBOARD_FRAME" },
  { key: "AUDIO_TRACK" }
] as const;

export type AssetFilterKey = (typeof ASSET_FILTERS)[number]["key"];

export type LibraryAsset = {
  id: string;
  taskId: string;
  pipelineRunId: string | null;
  type: string;
  status: string;
  storageKey: string;
  mimeType: string | null;
  sceneIndex: number | null;
  taskTitle: string;
  url: string | null;
};

const ASSET_TYPE_MAP: Record<string, string> = {
  source_video: "SOURCE_VIDEO",
  source_image: "STORYBOARD_FRAME",
  audio: "AUDIO_TRACK",
  tts_segment: "AUDIO_TRACK",
  keyframe: "STORYBOARD_FRAME",
  generated_frame: "STORYBOARD_FRAME",
  video_segment: "VIDEO_SEGMENT",
  subtitle: "SUBTITLE",
  final_video: "FINAL_VIDEO"
};

export function mapAssetType(assetType: string) {
  return ASSET_TYPE_MAP[assetType] ?? assetType.toUpperCase();
}

export function mapAssetStatus(status?: string) {
  if (!status) return "READY";
  return status.toUpperCase();
}

export function toLibraryAsset(asset: Asset, taskTitle: string): LibraryAsset {
  const status = mapAssetStatus(asset.status);
  return {
    id: asset.id,
    taskId: asset.task_id,
    pipelineRunId: asset.run_id ?? null,
    type: mapAssetType(asset.asset_type),
    status,
    storageKey: asset.path,
    mimeType: asset.mime_type ?? null,
    sceneIndex: asset.scene_index ?? null,
    taskTitle,
    url: status === "READY" ? toAssetUrl(asset.path) : null
  };
}

export function toLibraryAssets(assets: Asset[], taskTitles: Record<string, string>) {
  return assets
    .map((asset) => toLibraryAsset(asset, taskTitles[asset.task_id] ?? asset.task_id))
    .sort(compareLibraryAssets);
}

function compareLibraryAssets(left: LibraryAsset, right: LibraryAsset) {
  const leftRank = assetSortRank(left);
  const rightRank = assetSortRank(right);
  if (leftRank !== rightRank) return leftRank - rightRank;
  const leftScene = left.sceneIndex ?? Number.MAX_SAFE_INTEGER;
  const rightScene = right.sceneIndex ?? Number.MAX_SAFE_INTEGER;
  if (leftScene !== rightScene) return leftScene - rightScene;
  return left.storageKey.localeCompare(right.storageKey);
}

function assetSortRank(asset: LibraryAsset) {
  if (asset.type === "FINAL_VIDEO") return 0;
  if (asset.type === "VIDEO_SEGMENT") return 1;
  if (asset.type === "SOURCE_VIDEO") return 2;
  if (asset.type === "STORYBOARD_FRAME") return 3;
  if (asset.type === "AUDIO_TRACK") return 4;
  return 5;
}

export function filterLibraryAssets(assets: LibraryAsset[], filter: AssetFilterKey) {
  if (filter === "all") return assets;
  return assets.filter((asset) => asset.type === filter);
}

export function isAssetFilterKey(value: string | undefined): value is AssetFilterKey {
  return ASSET_FILTERS.some((entry) => entry.key === value);
}