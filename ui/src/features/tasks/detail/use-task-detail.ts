import { useCallback, useEffect, useRef, useState } from "react";
import { useServices } from "@/services/context";
import type { RunDetail } from "@/types";
import { loadTaskDetail } from "./load-task-detail";
import {
  formatTaskDetailError,
  type LoadedTaskDetail,
  type TaskDetailController
} from "./task-detail-model";

type DetailState = Omit<TaskDetailController, "refresh" | "updateRun">;

const INITIAL_STATE: DetailState = {
  data: null,
  loading: true,
  loadError: null,
  refreshError: null,
  lastUpdated: null
};

export function useTaskDetail(
  taskId: string | null,
  runId: string | null
): TaskDetailController {
  const services = useServices();
  const [state, setState] = useState<DetailState>(INITIAL_STATE);
  const requestId = useRef(0);
  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setState((current) => ({ ...current, loading: true, refreshError: null }));
    try {
      if (!taskId) throw new Error("No task selected");
      const data = await loadTaskDetail({ taskId, preferredRunId: runId, services });
      if (currentRequest !== requestId.current) return;
      setState(successfulRefresh(data));
    } catch (error) {
      if (currentRequest !== requestId.current) return;
      setState((current) => failedRefresh(current, formatTaskDetailError(error)));
    }
  }, [runId, services, taskId]);
  const updateRun = useCallback((detail: RunDetail) => {
    setState((current) =>
      current.data ? { ...current, data: { ...current.data, detail } } : current
    );
  }, []);

  useEffect(() => {
    setState((current) => ({
      ...current,
      data: current.data?.task.id === taskId ? current.data : null,
      loading: true
    }));
  }, [taskId]);
  useEffect(() => {
    void refresh();
    return () => {
      requestId.current += 1;
    };
  }, [refresh]);

  return { ...state, refresh, updateRun };
}

function successfulRefresh(data: LoadedTaskDetail): DetailState {
  return {
    data,
    loading: false,
    loadError: null,
    refreshError: null,
    lastUpdated: new Date()
  };
}

function failedRefresh(current: DetailState, message: string): DetailState {
  return current.data
    ? { ...current, loading: false, refreshError: message }
    : { ...current, loading: false, loadError: message };
}
