import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import { getRun, getRunCosts, listAssets, revealAsset } from "@/api";
import { AssetSections } from "@/components/AssetSections";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocale, useTranslations } from "@/i18n/context";
import { toLibraryAssets } from "@/lib/library";
import { cn } from "@/lib/utils";
import type { CostSummary, PipelineEvent } from "@/types";
import type { LibraryAsset } from "@/lib/library";

type StageStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
type RunStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export type StageSnapshot = { type: string; label: string; status: StageStatus };
export type LogSnapshot = { ts: string; level: string; message: string };

type ConsoleLiveProps = {
  runId: string;
  taskId: string;
  taskTitle: string;
  initialStages: StageSnapshot[];
  initialLogs: LogSnapshot[];
  initialStatus: RunStatus;
  initialAssets: LibraryAsset[];
  initialCostSummary: CostSummary;
  assetTitle: string;
  assetEmptyText: string;
  assetSigningErrorLabel: string;
  statusLabels: Record<string, string>;
};

const ASSET_REFRESH_STAGE_STATUSES = new Set<StageStatus>(["COMPLETED", "FAILED"]);
const ASSET_REFRESH_RUN_STATUSES = new Set<RunStatus>(["COMPLETED", "FAILED", "CANCELLED"]);
const ACTIVE_RUN_STATUSES = new Set<RunStatus>(["RUNNING", "PENDING"]);
const POLL_INTERVAL_MS = 3000;

const stageIcon = {
  COMPLETED: CheckCircle2,
  RUNNING: Loader2,
  PENDING: Circle,
  FAILED: XCircle,
  CANCELLED: XCircle
} as const;

const stageColor = {
  COMPLETED: "text-emerald-300",
  RUNNING: "text-blue-300",
  PENDING: "text-slate-500",
  FAILED: "text-red-300",
  CANCELLED: "text-red-300"
} as const;

const logColor: Record<string, string> = {
  INFO: "text-emerald-300",
  WARN: "text-amber-300",
  ERROR: "text-red-300",
  DEBUG: "text-blue-300"
};

const runBadge: Record<RunStatus, "success" | "warning" | "destructive" | "secondary"> = {
  COMPLETED: "success",
  RUNNING: "warning",
  FAILED: "destructive",
  CANCELLED: "destructive",
  PENDING: "secondary"
};

export function ConsoleLive(props: ConsoleLiveProps) {
  const live = useConsoleLiveData(props);

  return (
    <div className="flex flex-1 flex-col gap-5 px-4 pb-6 pt-3 lg:px-6">
      <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <StageTimeline status={live.status} stages={live.stages} />
        <LogPanel connected={live.connected} logs={live.logs} status={live.status} />
      </div>
      <CostPanel summary={live.costSummary} error={live.costError} />
      <FinalOutputPanel status={live.status} assets={live.assets} />
      <TaskAssets
        title={props.assetTitle}
        assets={live.assets}
        emptyText={props.assetEmptyText}
        signingError={live.assetError}
        signingErrorLabel={props.assetSigningErrorLabel}
        statusLabels={props.statusLabels}
      />
    </div>
  );
}

function useConsoleLiveData({
  runId,
  taskId,
  taskTitle,
  initialStages,
  initialLogs,
  initialStatus,
  initialAssets,
  initialCostSummary
}: ConsoleLiveProps) {
  const { locale } = useLocale();
  const [stages, setStages] = useState(initialStages);
  const [logs, setLogs] = useState(initialLogs);
  const [status, setStatus] = useState<RunStatus>(initialStatus);
  const [assets, setAssets] = useState(initialAssets);
  const [costSummary, setCostSummary] = useState(initialCostSummary);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [costError, setCostError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const latestAssetRequest = useRef(0);
  const latestCostRequest = useRef(0);
  const latestSnapshotRequest = useRef(0);

  useEffect(() => {
    setStages(initialStages);
    setLogs(initialLogs);
    setStatus(initialStatus);
    setAssets(initialAssets);
    setCostSummary(initialCostSummary);
    setAssetError(null);
    setCostError(null);
  }, [runId, initialStages, initialLogs, initialStatus, initialAssets, initialCostSummary]);

  useEffect(() => {
    let active = true;

    const refreshAssets = createAssetRefresh(taskId, taskTitle, latestAssetRequest, {
      isActive: () => active,
      setAssets,
      setAssetError
    });
    const refreshCosts = createCostRefresh(runId, latestCostRequest, {
      isActive: () => active,
      setCostSummary,
      setCostError
    });
    const applyEvent = createEventHandler({
      locale,
      refreshAssets,
      refreshCosts,
      setLogs,
      setStages,
      setStatus
    });

    let unlisten: (() => void) | undefined;

    void listen<PipelineEvent>("pipeline-event", (event) => {
      const payload = event.payload;
      if (payload.run_id !== runId) return;
      applyEvent(payload);
    })
      .then((dispose) => {
        if (!active) {
          void dispose();
          return;
        }
        unlisten = dispose;
        setConnected(true);
        void refreshAssets();
        void refreshCosts();
      })
      .catch(() => setConnected(false));

    return () => {
      active = false;
      unlisten?.();
      setConnected(false);
    };
  }, [locale, runId, taskId, taskTitle]);

  useEffect(() => {
    if (!ASSET_REFRESH_RUN_STATUSES.has(status)) return;

    let active = true;
    void listAssets(taskId)
      .then((rows) => {
        if (!active) return;
        setAssets(toLibraryAssets(rows, { [taskId]: taskTitle }));
        setAssetError(null);
      })
      .catch((err) => {
        if (!active) return;
        setAssetError(formatError(err));
      });
    return () => {
      active = false;
    };
  }, [status, taskId, taskTitle]);

  useEffect(() => {
    if (!ACTIVE_RUN_STATUSES.has(status)) return;

    let active = true;
    const refreshSnapshot = createSnapshotRefresh(runId, latestSnapshotRequest, {
      isActive: () => active,
      setStages,
      setLogs,
      setStatus
    });

    const id = window.setInterval(() => {
      void refreshSnapshot();
    }, POLL_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [runId, status]);

  return {
    stages,
    logs,
    status,
    connected,
    assets,
    assetError,
    costSummary,
    costError
  };
}

function createAssetRefresh(
  taskId: string,
  taskTitle: string,
  latestRequest: { current: number },
  actions: {
    isActive: () => boolean;
    setAssets: (assets: LibraryAsset[]) => void;
    setAssetError: (error: string | null) => void;
  }
) {
  return async function refreshAssets() {
    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;

    try {
      const rows = await listAssets(taskId);
      if (!shouldApplyRefresh(actions.isActive(), latestRequest.current, requestId)) return;
      actions.setAssets(toLibraryAssets(rows, { [taskId]: taskTitle }));
      actions.setAssetError(null);
    } catch (err) {
      if (!shouldApplyRefresh(actions.isActive(), latestRequest.current, requestId)) return;
      actions.setAssetError(formatError(err));
    }
  };
}

function createCostRefresh(
  runId: string,
  latestRequest: { current: number },
  actions: {
    isActive: () => boolean;
    setCostSummary: (summary: CostSummary) => void;
    setCostError: (error: string | null) => void;
  }
) {
  return async function refreshCosts() {
    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;

    try {
      const refreshed = await getRunCosts(runId);
      if (!shouldApplyRefresh(actions.isActive(), latestRequest.current, requestId)) return;
      actions.setCostSummary(refreshed);
      actions.setCostError(null);
    } catch (err) {
      if (!shouldApplyRefresh(actions.isActive(), latestRequest.current, requestId)) return;
      actions.setCostError(formatError(err));
    }
  };
}

function createSnapshotRefresh(
  runId: string,
  latestRequest: { current: number },
  actions: {
    isActive: () => boolean;
    setStages: (update: (prev: StageSnapshot[]) => StageSnapshot[]) => void;
    setLogs: (update: (prev: LogSnapshot[]) => LogSnapshot[]) => void;
    setStatus: (status: RunStatus) => void;
  }
) {
  return async function refreshSnapshot() {
    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;

    try {
      const detail = await getRun(runId);
      if (!shouldApplyRefresh(actions.isActive(), latestRequest.current, requestId) || !detail) return;

      actions.setStatus(detail.status as RunStatus);
      actions.setStages((prev) =>
        detail.stages.map((stage) => {
          const existing = prev.find((entry) => entry.type === stage.stage_type);
          return {
            type: stage.stage_type,
            label: existing?.label ?? stage.stage_type,
            status: stage.status as StageStatus
          };
        })
      );
      actions.setLogs(() => detail.logs);
    } catch {
      // Polling fallback is best-effort.
    }
  };
}

function createEventHandler(options: {
  locale: string;
  refreshAssets: () => Promise<void>;
  refreshCosts: () => Promise<void>;
  setLogs: (update: (prev: LogSnapshot[]) => LogSnapshot[]) => void;
  setStages: (update: (prev: StageSnapshot[]) => StageSnapshot[]) => void;
  setStatus: (status: RunStatus) => void;
}) {
  return function applyEvent(event: PipelineEvent) {
    if (event.event === "run") {
      options.setStatus(event.status as RunStatus);
      if (ASSET_REFRESH_RUN_STATUSES.has(event.status as RunStatus)) {
        void options.refreshAssets();
      }
    }
    if (event.event === "stage") {
      options.setStages((prev) =>
        prev.map((stage) =>
          stage.type === event.stage ? { ...stage, status: event.status as StageStatus } : stage
        )
      );
      if (ASSET_REFRESH_STAGE_STATUSES.has(event.status as StageStatus)) {
        void options.refreshAssets();
      }
    }
    if (event.event === "log") {
      options.setLogs((prev) => [
        ...prev,
        {
          ts: new Date().toLocaleTimeString(options.locale, { hour12: false }),
          level: event.level,
          message: event.message
        }
      ]);
    }
    void options.refreshCosts();
  };
}

function shouldApplyRefresh(active: boolean, latestRequest: number, requestId: number) {
  return active && latestRequest === requestId;
}

function formatError(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function CostPanel({ summary, error }: { summary: CostSummary; error: string | null }) {
  const t = useTranslations("console");

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>{t("costsTitle")}</CardTitle>
        <div className="flex items-center gap-2">
          {summary.incomplete ? <Badge variant="warning">{t("costIncomplete")}</Badge> : null}
          <span className="text-lg font-semibold">{formatUsd(summary.total_cost_usd)}</span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        {summary.providers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noCosts")}</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {summary.providers.map((row) => (
              <ProviderCostRow key={row.provider} row={row} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProviderCostRow({ row }: { row: CostSummary["providers"][number] }) {
  const t = useTranslations("console");

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-sm font-semibold">{row.provider}</span>
        <span className="text-sm font-semibold">{formatUsd(row.cost_usd)}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("costUsageMeta", {
          quantity: formatQuantity(row.quantity),
          unit: row.unit,
          calls: row.calls
        })}
      </p>
      {row.unknown_cost_count > 0 ? (
        <p className="mt-1 text-xs text-amber-300">
          {t("unknownCostCalls", { count: row.unknown_cost_count })}
        </p>
      ) : null}
      {row.failed_calls > 0 ? (
        <p className="mt-1 text-xs text-red-300">{t("failedCostCalls", { count: row.failed_calls })}</p>
      ) : null}
    </div>
  );
}

function FinalOutputPanel({
  status,
  assets
}: {
  status: RunStatus;
  assets: LibraryAsset[];
}) {
  const t = useTranslations("console");
  const finalAsset = assets.find((asset) => asset.type === "FINAL_VIDEO");

  if (status !== "COMPLETED" || !finalAsset) return null;

  return (
    <Card className="overflow-hidden border-emerald-400/20 bg-emerald-500/[0.04]">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>{t("finalOutputTitle")}</CardTitle>
        <Button
          onClick={() => void revealAsset(finalAsset.storageKey)}
          size="sm"
          type="button"
          variant="outline"
        >
          {t("openInFolder")}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t("finalOutputHint")}</p>
        {finalAsset.url ? (
          <video
            src={finalAsset.url}
            controls
            className="aspect-video w-full rounded-md bg-black object-contain"
          />
        ) : (
          <p className="text-sm text-amber-300">{finalAsset.storageKey}</p>
        )}
      </CardContent>
    </Card>
  );
}

function TaskAssets({
  title,
  assets,
  emptyText,
  signingError,
  signingErrorLabel,
  statusLabels
}: {
  title: string;
  assets: LibraryAsset[];
  emptyText: string;
  signingError: string | null;
  signingErrorLabel: string;
  statusLabels: Record<string, string>;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <AssetSections
        assets={assets}
        emptyText={emptyText}
        signingError={signingError}
        signingErrorLabel={signingErrorLabel}
        statusLabels={statusLabels}
        showTaskTitle={false}
      />
    </section>
  );
}

function formatUsd(value: number) {
  return `$${value.toFixed(4)}`;
}

function formatQuantity(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function StageTimeline({ status, stages }: { status: RunStatus; stages: StageSnapshot[] }) {
  const t = useTranslations("console");
  const tStatus = useTranslations("status");

  return (
    <Card className="h-fit">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t("stages")}</CardTitle>
        <Badge variant={runBadge[status]}>{tStatus(status)}</Badge>
      </CardHeader>
      <CardContent className="relative flex flex-col gap-3">
        <span className="absolute bottom-6 left-8 top-0 w-px bg-white/10" />
        {stages.map((stage, index) => (
          <StageRow key={stage.type} index={index + 1} stage={stage} />
        ))}
      </CardContent>
    </Card>
  );
}

function StageRow({ index, stage }: { index: number; stage: StageSnapshot }) {
  const t = useTranslations("console");
  const Icon = stageIcon[stage.status] ?? Circle;

  return (
    <div className="relative flex gap-4 rounded-lg border border-white/[0.06] bg-white/[0.03] p-4">
      <span className="z-10 flex size-9 shrink-0 items-center justify-center rounded-full bg-[#0b1625] ring-1 ring-white/10">
        <Icon
          className={cn(
            "size-5",
            stageColor[stage.status] ?? "text-slate-500",
            stage.status === "RUNNING" && "animate-spin"
          )}
        />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="truncate text-sm font-semibold">{stage.label}</h3>
          <span className="text-xs text-muted-foreground">0{index}</span>
        </div>
        <p className="text-xs text-muted-foreground">{getStageText(stage.status, t)}</p>
      </div>
    </div>
  );
}

function LogPanel({
  connected,
  logs,
  status
}: {
  connected: boolean;
  logs: LogSnapshot[];
  status: RunStatus;
}) {
  const t = useTranslations("console");

  return (
    <Card className="flex min-h-[520px] flex-col">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t("liveLog")}</CardTitle>
        <ConnectionState connected={connected} status={status} />
      </CardHeader>
      <CardContent className="flex-1">
        <div className="h-full rounded-lg border border-white/[0.06] bg-[#06101d] p-4 font-mono text-xs">
          {logs.length === 0 ? (
            <span className="text-muted-foreground">{t("noLogs")}</span>
          ) : (
            <div className="flex flex-col gap-2">
              {logs.map((log, index) => (
                <LogLine key={index} log={log} />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function LogLine({ log }: { log: LogSnapshot }) {
  return (
    <div className="grid grid-cols-[76px_52px_1fr] gap-3">
      <span className="text-muted-foreground">[{log.ts}]</span>
      <span className={cn("font-semibold", logColor[log.level] ?? "text-slate-300")}>{log.level}</span>
      <span className="text-slate-200">{log.message}</span>
    </div>
  );
}

function ConnectionState({ connected, status }: { connected: boolean; status: RunStatus }) {
  const t = useTranslations("console");
  const live = status === "RUNNING" || status === "PENDING";

  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground">
      <span
        className={cn(
          "size-2 rounded-full",
          connected && live ? "animate-pulse bg-emerald-400" : "bg-slate-500",
          !connected && "bg-red-400"
        )}
      />
      {connected ? (live ? t("streaming") : t("idle")) : t("disconnected")}
    </span>
  );
}

function getStageText(status: StageStatus, t: (key: string) => string) {
  if (status === "RUNNING") return t("stageStatus.running");
  if (status === "COMPLETED") return t("stageStatus.done");
  if (status === "FAILED" || status === "CANCELLED") return t("stageStatus.failed");
  return t("stageStatus.queued");
}