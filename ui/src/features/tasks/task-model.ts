import type { RunListItem, Task, TaskSummary } from "@/types";

export type TaskFilter = "all" | "running" | "attention" | "completed";

export type { TaskSummary } from "@/types";

const RUNNING_STATUSES = new Set(["PENDING", "RUNNING"]);
const ATTENTION_STATUSES = new Set([
  "DRAFT",
  "FAILED",
  "CANCELLED",
  "CANCELED",
  "PAUSED",
]);

export function aggregateTasks(
  tasks: Task[],
  runs: RunListItem[],
): TaskSummary[] {
  const runsByTask = groupRunsByTask(runs);
  return tasks
    .map((task) => createSummary(task, runsByTask.get(task.id) ?? []))
    .sort(
      (left, right) =>
        toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt),
    );
}

export function filterTaskSummaries(
  summaries: TaskSummary[],
  filter: TaskFilter,
  search: string,
) {
  const query = search.trim().toLocaleLowerCase();
  return summaries.filter((summary) => {
    const matchesSearch =
      !query || summary.task.title.toLocaleLowerCase().includes(query);
    return matchesSearch && matchesFilter(summary.status, filter);
  });
}

function groupRunsByTask(runs: RunListItem[]) {
  const grouped = new Map<string, RunListItem[]>();
  for (const run of runs) {
    const existing = grouped.get(run.task_id) ?? [];
    grouped.set(run.task_id, [...existing, run]);
  }
  for (const [taskId, taskRuns] of grouped) {
    grouped.set(taskId, [...taskRuns].sort(compareRunsNewestFirst));
  }
  return grouped;
}

function createSummary(task: Task, runs: RunListItem[]): TaskSummary {
  const latestRun = runs[0] ?? null;
  return {
    task,
    latestRun,
    runs,
    status: normalizeStatus(latestRun?.status ?? task.status),
    currentStage: latestRun?.current_stage ?? null,
    updatedAt: newestTimestamp(task.updated_at, latestRun?.created_at),
  };
}

function normalizeStatus(status: string) {
  const normalized = status.toUpperCase();
  return normalized === "CANCELED" ? "CANCELLED" : normalized;
}

function matchesFilter(status: string, filter: TaskFilter) {
  if (filter === "all") return true;
  if (filter === "running") return RUNNING_STATUSES.has(status);
  if (filter === "attention") return ATTENTION_STATUSES.has(status);
  return status === "COMPLETED";
}

function compareRunsNewestFirst(left: RunListItem, right: RunListItem) {
  return toTimestamp(right.created_at) - toTimestamp(left.created_at);
}

function toTimestamp(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function newestTimestamp(taskUpdatedAt: string, runCreatedAt?: string) {
  if (!runCreatedAt) return taskUpdatedAt;
  return toTimestamp(runCreatedAt) > toTimestamp(taskUpdatedAt)
    ? runCreatedAt
    : taskUpdatedAt;
}
