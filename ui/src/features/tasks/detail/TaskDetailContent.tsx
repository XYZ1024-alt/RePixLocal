import { PageHeader } from "@/components/PageHeader";
import { useTranslations } from "@/i18n/context";
import type { RunDetail } from "@/types";
import type {
  LoadedTaskDetail,
  TaskDetailController,
  TaskDetailNavigation
} from "./task-detail-model";
import { TaskDetailBackButton } from "./TaskDetailStates";
import { TaskDetailDraft } from "./TaskDetailDraft";
import { TaskDetailRun } from "./TaskDetailRun";
import { TaskDetailStatusRegion } from "./TaskDetailStatusRegion";
import { useTaskActions } from "./use-task-actions";

export function TaskDetailContent({
  data,
  detailState,
  navigation
}: {
  data: LoadedTaskDetail;
  detailState: TaskDetailController;
  navigation: TaskDetailNavigation;
}) {
  const t = useTranslations("tasks");
  const actionState = useTaskActions({
    task: data.task,
    navigation,
    refresh: detailState.refresh
  });
  return (
    <>
      <PageHeader
        title={data.task.title}
        description={data.task.id}
        actions={
          <TaskDetailBackButton label={t("backToTasks")} onBack={navigation.onBack} />
        }
      />
      <TaskDetailStatusRegion
        task={data.task}
        detail={data.detail}
        actions={actionState.actions}
        busy={actionState.busy}
        actionError={actionState.error}
        refreshError={detailState.refreshError}
        lastUpdated={detailState.lastUpdated}
        onRetry={detailState.refresh}
      />
      <TaskDetailBody
        data={data}
        busy={actionState.busy}
        onStart={actionState.actions.start}
        onRunSelected={navigation.onRunSelected}
        onRunUpdate={detailState.updateRun}
      />
    </>
  );
}

function TaskDetailBody({
  data,
  busy,
  onStart,
  onRunSelected,
  onRunUpdate
}: {
  data: LoadedTaskDetail;
  busy: boolean;
  onStart: () => Promise<void>;
  onRunSelected?: (runId: string) => void;
  onRunUpdate: (detail: RunDetail) => void;
}) {
  return data.detail ? (
    <TaskDetailRun
      data={data}
      onRunSelected={onRunSelected}
      onRunUpdate={onRunUpdate}
    />
  ) : (
    <TaskDetailDraft task={data.task} assets={data.assets} busy={busy} onStart={onStart} />
  );
}
