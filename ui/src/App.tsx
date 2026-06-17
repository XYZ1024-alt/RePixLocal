import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { checkFfmpeg, getDashboardData, getSettings } from "./api";
import { Shell } from "./components/Shell";
import { DashboardView } from "./views/DashboardView";
import { TaskWizardView } from "./views/TaskWizardView";
import { ConsoleListView } from "./views/ConsoleListView";
import { ConsoleDetailView } from "./views/ConsoleDetailView";
import { AssetLibraryView } from "./views/AssetLibraryView";
import { SettingsView } from "./views/SettingsView";
import type { DashboardData, Settings, ToolCheck, ViewKey } from "./types";

export function App() {
  const [view, setView] = useState<ViewKey>("dashboard");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [settings, setSettings] = useState<Settings>({ workspace_root: "" });
  const [tools, setTools] = useState<ToolCheck[]>([]);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const [nextSettings, nextTools, nextDashboard] = await Promise.all([
      getSettings(),
      checkFfmpeg(),
      getDashboardData()
    ]);
    setSettings(nextSettings);
    setTools(nextTools);
    setDashboardData(nextDashboard);
  }, []);

  useEffect(() => {
    refresh().catch((error) => setMessage(String(error)));
  }, [refresh]);

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
        <ConsoleListView onOpenRun={navigateToConsoleDetail} />
      )}
      {view === "console-detail" && (
        <ConsoleDetailView runId={selectedRunId} onBack={() => navigate("console")} />
      )}
      {view === "library" && <AssetLibraryView onNewTask={navigateToWizard} />}
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