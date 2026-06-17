import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  cancelTask,
  checkFfmpeg,
  getDashboardData,
  getLatestRun,
  getSettings,
  listAllAssets,
  listLogs,
  listRunStages,
  listTasks
} from "./api";
import { Shell } from "./components/Shell";
import { DashboardView } from "./views/DashboardView";
import { TaskWizardView } from "./views/TaskWizardView";
import { PipelineConsoleView } from "./views/PipelineConsoleView";
import { AssetLibraryView } from "./views/AssetLibraryView";
import { SettingsView } from "./views/SettingsView";
import { ConsoleDetailPlaceholder } from "./views/ConsoleDetailPlaceholder";
import type {
  AppLog,
  Asset,
  DashboardData,
  PipelineRun,
  PipelineStage,
  Settings,
  Task,
  ToolCheck,
  ViewKey
} from "./types";

export function App() {
  const [view, setView] = useState<ViewKey>("dashboard");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [logs, setLogs] = useState<AppLog[]>([]);
  const [run, setRun] = useState<PipelineRun | null>(null);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [settings, setSettings] = useState<Settings>({ workspace_root: "" });
  const [tools, setTools] = useState<ToolCheck[]>([]);
  const [message, setMessage] = useState("");

  const loadTaskDetails = useCallback(async (taskId: string) => {
    if (!taskId) {
      setLogs([]);
      setRun(null);
      setStages([]);
      return;
    }

    const [nextLogs, nextRun] = await Promise.all([listLogs(taskId), getLatestRun(taskId)]);
    setLogs(nextLogs);
    setRun(nextRun);
    if (nextRun) {
      setStages(await listRunStages(nextRun.id));
      setSelectedRunId(nextRun.id);
    } else {
      setStages([]);
    }
  }, []);

  const refresh = useCallback(async () => {
    const [nextTasks, nextSettings, nextTools, nextDashboard, nextAssets] = await Promise.all([
      listTasks(),
      getSettings(),
      checkFfmpeg(),
      getDashboardData(),
      listAllAssets()
    ]);
    setTasks(nextTasks);
    setSettings(nextSettings);
    setTools(nextTools);
    setDashboardData(nextDashboard);
    setAssets(nextAssets);

    const nextSelectedTaskId =
      nextTasks.some((task) => task.id === selectedTaskId) ? selectedTaskId : (nextTasks[0]?.id ?? "");
    if (nextSelectedTaskId !== selectedTaskId) {
      setSelectedTaskId(nextSelectedTaskId);
    }
    if (nextSelectedTaskId) {
      await loadTaskDetails(nextSelectedTaskId);
    } else {
      setLogs([]);
      setRun(null);
      setStages([]);
    }
  }, [loadTaskDetails, selectedTaskId]);

  useEffect(() => {
    refresh().catch((error) => setMessage(String(error)));
  }, []);

  useEffect(() => {
    if ((view !== "console" && view !== "console-detail") || !selectedTaskId) return;
    const id = window.setInterval(() => {
      loadTaskDetails(selectedTaskId).catch((error) => setMessage(String(error)));
    }, 3000);
    return () => window.clearInterval(id);
  }, [view, selectedTaskId, loadTaskDetails]);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? tasks[0],
    [tasks, selectedTaskId]
  );

  function navigate(viewKey: ViewKey) {
    setView(viewKey);
    if (viewKey !== "console-detail") {
      setSelectedRunId(null);
    }
  }

  function navigateToWizard() {
    navigate("wizard");
  }

  function navigateToConsoleDetail(runId: string) {
    setSelectedRunId(runId);
    setView("console-detail");
  }

  async function handleSelectTask(taskId: string) {
    setSelectedTaskId(taskId);
    await loadTaskDetails(taskId).catch((error) => setMessage(String(error)));
  }

  async function stopTask(taskId: string) {
    await cancelTask(taskId).catch((error) => setMessage(String(error)));
    await refresh();
    await loadTaskDetails(taskId).catch((error) => setMessage(String(error)));
  }

  async function handleWizardSubmitted(runId: string) {
    await refresh();
    navigateToConsoleDetail(runId);
  }

  return (
    <Shell activeView={view} hasError={Boolean(message)} onNavigate={navigate}>
      {message && <ErrorBanner message={message} onDismiss={() => setMessage("")} />}
      {view === "dashboard" && (
        <DashboardView data={dashboardData} onNewTask={navigateToWizard} />
      )}
      {view === "wizard" && <TaskWizardView onSubmitted={handleWizardSubmitted} />}
      {view === "console" && (
        <PipelineConsoleView
          logs={logs}
          run={run}
          selectedTaskId={selectedTaskId}
          stages={stages}
          task={selectedTask}
          tasks={tasks}
          onCancel={stopTask}
          onSelectTask={handleSelectTask}
        />
      )}
      {view === "console-detail" && <ConsoleDetailPlaceholder runId={selectedRunId} />}
      {view === "library" && (
        <AssetLibraryView
          assets={assets}
          selectedTaskId={selectedTaskId}
          tasks={tasks}
          onSelectTask={handleSelectTask}
        />
      )}
      {view === "settings" && (
        <SettingsView
          settings={settings}
          tools={tools}
          onRefresh={async () => {
            const nextTools = await checkFfmpeg();
            setTools(nextTools);
          }}
          onSettingsSaved={setSettings}
          onMessage={setMessage}
        />
      )}
    </Shell>
  );
}

function ErrorBanner(props: { message: string; onDismiss: () => void }) {
  return (
    <div className="mx-4 mt-3 flex items-center gap-2 rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200 lg:mx-6">
      <AlertTriangle size={16} />
      <span className="flex-1">{props.message}</span>
      <button className="text-xs text-red-100/80 hover:text-red-50" onClick={props.onDismiss} type="button">
        Dismiss
      </button>
    </div>
  );
}