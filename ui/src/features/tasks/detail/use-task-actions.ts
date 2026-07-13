import { useState } from "react";
import { useServices } from "@/services/context";
import type { Task } from "@/types";
import {
  formatTaskDetailError,
  type TaskDetailActions,
  type TaskDetailNavigation
} from "./task-detail-model";

type UseTaskActionsOptions = {
  task: Task;
  navigation: TaskDetailNavigation;
  refresh: () => Promise<void>;
};

export function useTaskActions({
  task,
  navigation,
  refresh
}: UseTaskActionsOptions): {
  actions: TaskDetailActions;
  busy: boolean;
  error: string | null;
} {
  const services = useServices();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const execute = async (operation: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    try {
      const runId = await operation();
      if (runId) {
        if (navigation.onResumed) navigation.onResumed(runId);
        else navigation.onRunSelected?.(runId);
      } else {
        await refresh();
      }
    } catch (actionError) {
      setError(formatTaskDetailError(actionError));
    } finally {
      setBusy(false);
    }
  };

  return {
    busy,
    error,
    actions: {
      cancel: () =>
        execute(async () => {
          await services.cancelTask(task.id);
          return null;
        }),
      resume: () => execute(async () => (await services.resumeTask(task.id)).run_id),
      start: () => execute(async () => (await services.submitTask(task.id)).run_id)
    }
  };
}
