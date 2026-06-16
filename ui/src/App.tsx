import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  cancelTask,
  checkFfmpeg,
  getDashboardSummary,
  getLatestRun,
  getSettings,
  listAssets,
  listLogs,
  listTasks,
  startTask
} from "./api";
import { Shell } from "./components/Shell";
import { DashboardView } from "./views/DashboardView";
import { TaskWizardView } from "./views/TaskWizardView";
import { PipelineConsoleView } from "./views/PipelineConsoleView";
import { AssetLibraryView } from "./views/AssetLibraryView";
import { SettingsView } from "./views/SettingsView";
import type { AppLog, Asset, DashboardSummary, PipelineRun, Settings, Task, ToolCheck, ViewKey } from "./types";

const emptySummary: DashboardSummary = {
  total_tasks: 0,
  running_tasks: 0,
  completed_tasks: 0,
  failed_tasks: 0,
  canceled_tasks: 0,
  asset_count: 0,
  latest_tasks: []
};

export function App() {
  const [view, setView] = useState<ViewKey>("dashboard");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [summary, setSummary] = useState(emptySummary);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [logs, setLogs] = useState<AppLog[]>([]);
  const [run, setRun] = useState<PipelineRun | null>(null);
  const [settings, setSettings] = useState<Settings>({ workspace_root: "" });
  const [tools, setTools] = useState<ToolCheck[]>([]);
  const [message, setMessage] = useState("");

  async function refresh() {
    const [nextSummary, nextTasks, nextSettings, nextTools] = await Promise.all([
      getDashboardSummary(),
      listTasks(),
      getSettings(),
      checkFfmpeg()
    ]);
    setSummary(nextSummary);
    setTasks(nextTasks);
    setSettings(nextSettings);
    setTools(nextTools);
  }

  useEffect(() => {
    refresh().catch((error) => setMessage(String(error)));
  }, []);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? tasks[0],
    [tasks, selectedTaskId]
  );

  async function openTask(taskId: string, target: ViewKey) {
    setSelectedTaskId(taskId);
    await loadTaskDetails(taskId);
    setView(target);
  }

  async function loadTaskDetails(taskId: string) {
    const [nextAssets, nextLogs, nextRun] = await Promise.all([
      listAssets(taskId),
      listLogs(taskId),
      getLatestRun(taskId)
    ]);
    setAssets(nextAssets);
    setLogs(nextLogs);
    setRun(nextRun);
  }

  async function runTask(taskId: string) {
    await startTask(taskId).catch((error) => setMessage(String(error)));
    await refresh();
    await loadTaskDetails(taskId).catch((error) => setMessage(String(error)));
  }

  async function stopTask(taskId: string) {
    await cancelTask(taskId).catch((error) => setMessage(String(error)));
    await refresh();
  }

  return (
    <Shell activeView={view} message={message} onClearMessage={() => setMessage("")} onNavigate={setView}>
      {message && <ErrorBanner message={message} />}
      {view === "dashboard" && <DashboardView summary={summary} tasks={tasks} onOpenTask={openTask} onStart={runTask} />}
      {view === "wizard" && <TaskWizardView onCreated={refresh} onMessage={setMessage} />}
      {view === "console" && <PipelineConsoleView task={selectedTask} run={run} logs={logs} onCancel={stopTask} />}
      {view === "library" && <AssetLibraryView tasks={tasks} assets={assets} onSelectTask={openTask} />}
      {view === "settings" && <SettingsView settings={settings} tools={tools} onRefresh={refresh} onMessage={setMessage} />}
    </Shell>
  );
}

function ErrorBanner(props: { message: string }) {
  return (
    <div className="error-banner">
      <AlertTriangle size={16} />
      <span>{props.message}</span>
    </div>
  );
}
