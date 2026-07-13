import { TaskDetailContent } from "@/features/tasks/detail/TaskDetailContent";
import {
  TaskDetailLoadError,
  TaskDetailLoading
} from "@/features/tasks/detail/TaskDetailStates";
import { useTaskDetail } from "@/features/tasks/detail/use-task-detail";

type ConsoleDetailProps = {
  taskId: string | null;
  runId: string | null;
  onBack: () => void;
  onRunSelected?: (runId: string) => void;
  onResumed?: (runId: string) => void;
};

export function ConsoleDetailView(props: ConsoleDetailProps) {
  const detailState = useTaskDetail(props.taskId, props.runId);

  if (!detailState.data && detailState.loading) {
    return <TaskDetailLoading onBack={props.onBack} />;
  }

  if (!detailState.data) {
    return (
      <TaskDetailLoadError
        error={detailState.loadError}
        onBack={props.onBack}
        onRetry={detailState.refresh}
      />
    );
  }

  return (
    <TaskDetailContent
      data={detailState.data}
      detailState={detailState}
      navigation={props}
    />
  );
}
