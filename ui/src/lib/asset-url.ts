import { convertFileSrc } from "@tauri-apps/api/core";

export function toAssetUrl(path: string | null | undefined) {
  if (!path) return null;
  return convertFileSrc(path);
}