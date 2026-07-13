import { useCallback, useEffect, useRef, useState } from "react";
import { useServices } from "@/services/context";
import { aggregateTasks, type TaskSummary } from "./task-model";

const REFRESH_INTERVAL_MS = 3000;

export function useTaskSummaries() {
  const { listRuns, listTasks } = useServices();
  const [summaries, setSummaries] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    try {
      const [tasks, runs] = await Promise.all([listTasks(), listRuns(100)]);
      if (currentRequest !== requestId.current) return;
      setSummaries(aggregateTasks(tasks, runs));
      setHasLoaded(true);
      setLastUpdated(new Date());
      setError(null);
    } catch (loadError) {
      if (currentRequest === requestId.current)
        setError(formatError(loadError));
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [listRuns, listTasks]);

  useEffect(() => {
    void refresh();
    const timerId = window.setInterval(
      () => void refresh(),
      REFRESH_INTERVAL_MS,
    );
    return () => {
      window.clearInterval(timerId);
      requestId.current += 1;
    };
  }, [refresh]);

  return { summaries, loading, hasLoaded, error, lastUpdated, refresh };
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
