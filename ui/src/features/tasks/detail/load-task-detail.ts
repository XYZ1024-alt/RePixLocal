import { toLibraryAssets } from "@/lib/library";
import type { AppServices } from "@/services/context";
import type { CostSummary, RunListItem } from "@/types";
import type { LoadedTaskDetail } from "./task-detail-model";

const EMPTY_COSTS: CostSummary = {
  total_cost_usd: 0,
  incomplete: false,
  providers: []
};

type LoadTaskDetailOptions = {
  taskId: string;
  preferredRunId: string | null;
  services: AppServices;
};

export async function loadTaskDetail({
  taskId,
  preferredRunId,
  services
}: LoadTaskDetailOptions): Promise<LoadedTaskDetail> {
  const [tasks, allRuns, assetRows] = await Promise.all([
    services.listTasks(),
    services.listRuns(100),
    services.listAssets(taskId)
  ]);
  const task = tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const runs = allRuns
    .filter((run) => run.task_id === taskId)
    .sort(compareRuns);
  const selectedRunId = preferredRunId ?? runs[0]?.id ?? null;
  const detail = selectedRunId ? await services.getRun(selectedRunId) : null;
  if (selectedRunId && !detail) {
    throw new Error(`Run not found: ${selectedRunId}`);
  }
  if (detail && detail.task_id !== taskId) {
    throw new Error(`Run ${selectedRunId} does not belong to task ${taskId}`);
  }

  const costs = selectedRunId
    ? await services.getRunCosts(selectedRunId)
    : EMPTY_COSTS;
  return {
    task,
    runs,
    detail,
    costs,
    assets: toLibraryAssets(assetRows, { [taskId]: task.title })
  };
}

function compareRuns(left: RunListItem, right: RunListItem) {
  return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
}
