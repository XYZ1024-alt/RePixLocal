import {
  ConsoleLive,
  type LogSnapshot,
  type RunStatus,
  type StageSnapshot
} from "@/components/ConsoleLive";
import { useTranslations } from "@/i18n/context";
import type { RunDetail } from "@/types";
import {
  getAssetStatusLabels,
  type LoadedTaskDetail
} from "./task-detail-model";

export function TaskDetailRun({
  data,
  onRunSelected,
  onRunUpdate
}: {
  data: LoadedTaskDetail;
  onRunSelected?: (runId: string) => void;
  onRunUpdate: (detail: RunDetail) => void;
}) {
  const t = useTranslations("console");
  const tStages = useTranslations("stages");
  const detail = data.detail;
  if (!detail) return null;

  const stages: StageSnapshot[] = detail.stages.map((stage) => ({
    type: stage.stage_type,
    label: tStages(stage.stage_type),
    status: stage.status as StageSnapshot["status"]
  }));
  return (
    <ConsoleLive
      runId={detail.id}
      taskId={detail.task_id}
      taskTitle={detail.task_title}
      initialStages={stages}
      initialLogs={detail.logs as LogSnapshot[]}
      initialStatus={detail.status as RunStatus}
      initialAssets={data.assets}
      initialCostSummary={data.costs}
      runs={data.runs}
      assetTitle={t("assetsTitle")}
      assetEmptyText={t("assetsEmpty")}
      assetSigningErrorLabel={t("assetSigningError")}
      statusLabels={getAssetStatusLabels(t)}
      onRunSelected={onRunSelected}
      onRunUpdate={onRunUpdate}
    />
  );
}
