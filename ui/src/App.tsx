import { listen } from "@tauri-apps/api/event";
import { AlertTriangle, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Shell } from "@/components/Shell";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { useTranslations } from "@/i18n/context";
import { useServices } from "@/services/context";
import { AssetLibraryView } from "@/views/AssetLibraryView";
import { ConsoleDetailView } from "@/views/ConsoleDetailView";
import { DashboardView } from "@/views/DashboardView";
import { SettingsView } from "@/views/SettingsView";
import { TaskWizardView } from "@/views/TaskWizardView";
import { TasksView } from "@/views/TasksView";
import type {
  AppRoute,
  DashboardData,
  NavigationIntent,
  PipelineEvent,
  ProviderCredentialView,
  ReadinessIssue,
  ReadinessState,
  Settings,
  ToolCheck
} from "@/types";

type CredentialState = {
  providers: ProviderCredentialView[];
  dashscopeConfigured: boolean;
  loaded: boolean;
};

type WizardResult = { taskId: string; runId: string };

const INITIAL_SETTINGS: Settings = { workspace_root: "" };

export function App() {
  const services = useServices();
  const [navigation, setNavigation] = useState<NavigationIntent>({ route: "home" });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth < 1100);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [dashboardLoaded, setDashboardLoaded] = useState(false);
  const [settings, setSettings] = useState<Settings>(INITIAL_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [tools, setTools] = useState<ToolCheck[]>([]);
  const [toolsLoaded, setToolsLoaded] = useState(false);
  const [credentials, setCredentials] = useState<CredentialState>({
    providers: [],
    dashscopeConfigured: false,
    loaded: false
  });
  const [message, setMessage] = useState("");
  const [wizardDirty, setWizardDirty] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<NavigationIntent | null>(null);
  const latestDashboardRequest = useRef(0);
  const latestToolsRequest = useRef(0);
  const whisperDownloadQueue = useWhisperQueue({ services, setMessage });

  const refreshDashboard = useCallback(async () => {
    const requestId = ++latestDashboardRequest.current;
    try {
      const nextDashboard = await services.getDashboardData();
      if (requestId === latestDashboardRequest.current) {
        setDashboardData(nextDashboard);
        setDashboardLoaded(true);
      }
    } catch (error) {
      if (requestId === latestDashboardRequest.current) throw error;
    }
  }, [services]);

  const refreshTools = useCallback(async () => {
    const requestId = ++latestToolsRequest.current;
    try {
      const nextTools = await services.checkFfmpeg();
      if (requestId === latestToolsRequest.current) {
        setTools(nextTools);
        setToolsLoaded(true);
      }
    } catch (error) {
      if (requestId === latestToolsRequest.current) throw error;
    }
  }, [services]);

  const refreshCredentials = useCallback(async () => {
    try {
      const [providerRows, dashscope] = await Promise.all([
        services.listProviderCredentials(),
        services.listDashscopeCredentials()
      ]);
      setCredentials({
        providers: providerRows,
        dashscopeConfigured: Boolean(dashscope.masked_key) && !dashscope.key_decrypt_failed,
        loaded: true
      });
    } catch (error) {
      setCredentials({ providers: [], dashscopeConfigured: false, loaded: true });
      throw error;
    }
  }, [services]);

  const startWhisperDownload = useCallback(
    (model?: string) => whisperDownloadQueue.start(model, refreshTools),
    [refreshTools, whisperDownloadQueue]
  );

  const refreshApp = useCallback(async () => {
    const nextSettings = await services.getSettings();
    setSettings(nextSettings);
    setSettingsLoaded(true);
    startWhisperDownload(nextSettings.asr_model);
    await Promise.all([refreshTools(), refreshCredentials()]);
  }, [refreshCredentials, refreshTools, services, startWhisperDownload]);

  useEffect(() => {
    refreshApp().catch((error) => setMessage(String(error)));
  }, [refreshApp]);

  const reportError = useCallback((error: unknown) => setMessage(String(error)), []);

  useDashboardEvents({
    active: navigation.route === "home",
    refreshDashboard,
    onError: reportError
  });

  const readiness = useMemo(
    () => buildReadiness({ settings, settingsLoaded, tools, toolsLoaded, credentials }),
    [credentials, settings, settingsLoaded, tools, toolsLoaded]
  );

  function commitNavigation(intent: NavigationIntent) {
    setNavigation(intent);
  }

  function navigate(intent: NavigationIntent | AppRoute) {
    const next = typeof intent === "string" ? { route: intent } : intent;
    if (navigation.route === "new-task" && next.route !== "new-task" && wizardDirty) {
      setPendingNavigation(next);
      return;
    }
    commitNavigation(next);
  }

  function handleWizardSubmitted(result: WizardResult) {
    setWizardDirty(false);
    commitNavigation({ route: "task-detail", taskId: result.taskId, runId: result.runId });
  }

  function handleSettingsSaved(next: Settings) {
    setSettings(next);
    void refreshCredentials().catch((error) => setMessage(String(error)));
  }

  return (
    <Shell
      activeRoute={navigation.route}
      collapsed={sidebarCollapsed}
      readiness={readiness}
      onNavigate={(route) => navigate(route)}
      onNewTask={() => navigate("new-task")}
      onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
    >
      {message ? <ErrorBanner message={message} onDismiss={() => setMessage("")} /> : null}
      <CurrentView
        navigation={navigation}
        dashboardData={dashboardData}
        dashboardLoaded={dashboardLoaded}
        settings={settings}
        tools={tools}
        readiness={readiness}
        onNavigate={navigate}
        onRefreshTools={refreshTools}
        onEnsureWhisperModel={startWhisperDownload}
        onSettingsSaved={handleSettingsSaved}
        onMessage={setMessage}
        onWizardDirtyChange={setWizardDirty}
        onWizardSubmitted={handleWizardSubmitted}
      />
      <LeaveDraftDialog
        open={pendingNavigation !== null}
        onKeep={() => {
          if (pendingNavigation) commitNavigation(pendingNavigation);
          setPendingNavigation(null);
        }}
        onStay={() => setPendingNavigation(null)}
        onDiscard={() => {
          sessionStorage.removeItem("repix:wizard-draft");
          setWizardDirty(false);
          if (pendingNavigation) commitNavigation(pendingNavigation);
          setPendingNavigation(null);
        }}
      />
    </Shell>
  );
}

function CurrentView(props: {
  navigation: NavigationIntent;
  dashboardData: DashboardData | null;
  dashboardLoaded: boolean;
  settings: Settings;
  tools: ToolCheck[];
  readiness: ReadinessState;
  onNavigate: (intent: NavigationIntent | AppRoute) => void;
  onRefreshTools: () => Promise<void>;
  onEnsureWhisperModel: (model?: string) => void;
  onSettingsSaved: (settings: Settings) => void;
  onMessage: (message: string) => void;
  onWizardDirtyChange: (dirty: boolean) => void;
  onWizardSubmitted: (result: WizardResult) => void;
}) {
  const services = useServices();
  const { navigation } = props;
  if (navigation.route === "home") {
    return (
      <DashboardView
        data={props.dashboardData}
        loaded={props.dashboardLoaded}
        onNewTask={() => props.onNavigate("new-task")}
        onOpenRun={(runId) => {
          void services
            .getRun(runId)
            .then((detail) => {
              if (!detail) throw new Error(`Run not found: ${runId}`);
              props.onNavigate({ route: "task-detail", taskId: detail.task_id, runId });
            })
            .catch((error) => props.onMessage(String(error)));
        }}
        onOpenTasks={(taskFilter) => props.onNavigate({ route: "tasks", taskFilter })}
      />
    );
  }
  if (navigation.route === "tasks") {
    return (
      <TasksView
        initialFilter={navigation.taskFilter}
        onOpenTask={(taskId, runId) =>
          props.onNavigate({ route: "task-detail", taskId, runId })
        }
      />
    );
  }
  if (navigation.route === "task-detail") {
    return (
      <ConsoleDetailView
        taskId={navigation.taskId ?? null}
        runId={navigation.runId ?? null}
        onBack={() => props.onNavigate({ route: "tasks" })}
        onResumed={(runId) => props.onNavigate({ ...navigation, runId })}
        onRunSelected={(runId) => props.onNavigate({ ...navigation, runId })}
      />
    );
  }
  if (navigation.route === "new-task") {
    return (
      <TaskWizardView
        readiness={props.readiness}
        onCancel={() => props.onNavigate("home")}
        onDirtyChange={props.onWizardDirtyChange}
        onOpenSettings={() => props.onNavigate("settings")}
        onSubmitted={props.onWizardSubmitted}
      />
    );
  }
  if (navigation.route === "assets") {
    return <AssetLibraryView />;
  }
  return (
    <SettingsView
      settings={props.settings}
      tools={props.tools}
      readiness={props.readiness}
      onEnsureWhisperModel={props.onEnsureWhisperModel}
      onRefresh={props.onRefreshTools}
      onSettingsSaved={props.onSettingsSaved}
      onMessage={props.onMessage}
    />
  );
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const t = useTranslations("shell");
  return (
    <div className="mx-4 mt-3 flex items-start gap-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger lg:mx-6" role="alert">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{t("unexpectedError")}</p>
        <details className="mt-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer">{t("technicalDetails")}</summary>
          <p className="mt-1 break-words font-mono">{message}</p>
        </details>
      </div>
      <button type="button" onClick={onDismiss} aria-label={t("dismiss")} className="rounded p-1 hover:bg-danger/10">
        <X className="size-4" />
      </button>
    </div>
  );
}

function LeaveDraftDialog({
  open,
  onKeep,
  onStay,
  onDiscard
}: {
  open: boolean;
  onKeep: () => void;
  onStay: () => void;
  onDiscard: () => void;
}) {
  const t = useTranslations("wizard");
  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => !nextOpen && onStay()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("leaveDraftTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("leaveDraftDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onStay}>{t("stay")}</AlertDialogCancel>
          <AlertDialogAction className="border border-border bg-transparent text-foreground hover:bg-accent" onClick={onDiscard}>
            {t("discardDraft")}
          </AlertDialogAction>
          <AlertDialogAction onClick={onKeep}>{t("keepDraft")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function useWhisperQueue({
  services,
  setMessage
}: {
  services: ReturnType<typeof useServices>;
  setMessage: (message: string) => void;
}) {
  const queue = useRef({
    activeModel: null as string | null,
    pendingModels: [] as string[],
    running: false,
    settledModel: null as string | null,
    settledSucceeded: false
  });

  return useMemo(
    () => ({
      start(model: string | undefined, refreshTools: () => Promise<void>) {
        const modelName = model?.trim() || "base";
        const state = queue.current;
        if (state.activeModel === modelName) return;
        if (state.settledModel === modelName && state.settledSucceeded) return;
        if (state.pendingModels.includes(modelName)) return;
        state.pendingModels.push(modelName);
        if (state.running) return;
        state.running = true;
        void runWhisperQueue({ state, services, refreshTools, setMessage });
      }
    }),
    [services, setMessage]
  );
}

async function runWhisperQueue(options: {
  state: {
    activeModel: string | null;
    pendingModels: string[];
    running: boolean;
    settledModel: string | null;
    settledSucceeded: boolean;
  };
  services: ReturnType<typeof useServices>;
  refreshTools: () => Promise<void>;
  setMessage: (message: string) => void;
}) {
  const { state } = options;
  try {
    while (state.pendingModels.length > 0) {
      const nextModel = state.pendingModels.shift() as string;
      state.activeModel = nextModel;
      let succeeded = false;
      try {
        await options.services.ensureWhisperModel(nextModel);
        succeeded = true;
      } catch (error) {
        options.setMessage(String(error));
      } finally {
        state.activeModel = null;
        state.settledModel = nextModel;
        state.settledSucceeded = succeeded;
        try {
          await options.refreshTools();
        } catch (error) {
          options.setMessage(String(error));
        } finally {
          state.settledModel = null;
          state.settledSucceeded = false;
        }
      }
    }
  } finally {
    state.activeModel = null;
    state.settledModel = null;
    state.settledSucceeded = false;
    state.running = false;
  }
}

function useDashboardEvents(options: {
  active: boolean;
  refreshDashboard: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  useEffect(() => {
    if (!options.active) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    const load = () => {
      if (active) void options.refreshDashboard().catch(options.onError);
    };
    void listen<PipelineEvent>("pipeline-event", (event) => {
      if (event.payload.event === "run") load();
    })
      .then((dispose) => {
        if (!active) return dispose();
        unlisten = dispose;
        load();
      })
      .catch((error) => {
        options.onError(error);
        load();
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [options.active, options.onError, options.refreshDashboard]);
}

function buildReadiness(options: {
  settings: Settings;
  settingsLoaded: boolean;
  tools: ToolCheck[];
  toolsLoaded: boolean;
  credentials: CredentialState;
}): ReadinessState {
  if (!options.settingsLoaded || !options.toolsLoaded || !options.credentials.loaded) {
    return { status: "checking", mockMode: Boolean(options.settings.mock_providers), issues: [] };
  }
  const issues: ReadinessIssue[] = options.tools
    .filter((tool) => !tool.found)
    .map((tool) => ({
      id: `tool-${tool.name}`,
      label: tool.name,
      detail: tool.error ?? tool.path ?? tool.name,
      severity: "error" as const
    }));
  const mockMode = Boolean(options.settings.mock_providers);
  if (!mockMode) {
    const configured = new Set(
      options.credentials.providers
        .filter((credential) => credential.masked_key && !credential.key_decrypt_failed)
        .map((credential) => credential.provider)
    );
    for (const provider of ["DEEPSEEK", "SEEDANCE"] as const) {
      if (!configured.has(provider)) {
        issues.push({ id: `provider-${provider}`, label: provider, detail: provider, severity: "warning" });
      }
    }
    if (!options.credentials.dashscopeConfigured) {
      issues.push({ id: "provider-DASHSCOPE", label: "DashScope", detail: "DashScope", severity: "warning" });
    }
  }
  return { status: issues.length ? "attention" : "ready", mockMode, issues };
}
