import type { StatusTone } from "@/components/ui/status-badge";
import type { LibraryAsset } from "@/lib/library";
import type { CostSummary, RunDetail, RunListItem, Task } from "@/types";

export type LoadedTaskDetail = {
  task: Task;
  runs: RunListItem[];
  detail: RunDetail | null;
  costs: CostSummary;
  assets: LibraryAsset[];
};

export type TaskDetailController = {
  data: LoadedTaskDetail | null;
  loading: boolean;
  loadError: string | null;
  refreshError: string | null;
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
  updateRun: (detail: RunDetail) => void;
};

export type TaskDetailNavigation = {
  onBack: () => void;
  onRunSelected?: (runId: string) => void;
  onResumed?: (runId: string) => void;
};

export type TaskDetailActions = {
  cancel: () => Promise<void>;
  resume: () => Promise<void>;
  start: () => Promise<void>;
};

export function formatTaskDetailError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function getAssetStatusLabels(t: (key: string) => string) {
  return {
    READY: t("assetStatuses.READY"),
    GENERATING: t("assetStatuses.GENERATING"),
    FAILED: t("assetStatuses.FAILED"),
    PENDING: t("assetStatuses.PENDING")
  };
}

export function taskStatusTone(status: string): StatusTone {
  if (status === "RUNNING") return "running";
  if (status === "COMPLETED") return "success";
  if (status === "FAILED" || status === "CANCELLED" || status === "CANCELED") return "error";
  if (status === "DRAFT") return "warning";
  return "neutral";
}

export function getDetailProgress(detail: RunDetail | null) {
  if (!detail) return 0;
  if (detail.status.toUpperCase() === "COMPLETED") return 100;
  if (detail.stages.length === 0) return 0;
  const completed = detail.stages.filter(
    (stage) => stage.status.toUpperCase() === "COMPLETED"
  ).length;
  return Math.round((completed / detail.stages.length) * 100);
}
