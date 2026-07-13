import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { AssetSections } from "@/components/AssetSections";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocale, useTranslations } from "@/i18n/context";
import { toLibraryAssets, type LibraryAsset } from "@/lib/library";
import { cn } from "@/lib/utils";
import { useServices } from "@/services/context";
import type {
  Asset,
  CostSummary,
  PipelineEvent,
  RunDetail,
  RunListItem,
} from "@/types";

export type StageStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";
export type RunStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";
export type StageSnapshot = {
  type: string;
  label: string;
  status: StageStatus;
};
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
  runs: RunListItem[];
  assetTitle: string;
  assetEmptyText: string;
  assetSigningErrorLabel: string;
  statusLabels: Record<string, string>;
  onRunSelected?: (runId: string) => void;
  onStatusChange?: (status: RunStatus) => void;
  onRunUpdate?: (detail: RunDetail) => void;
};

type LiveState = {
  stages: StageSnapshot[];
  logs: LogSnapshot[];
  status: RunStatus;
  assets: LibraryAsset[];
  costs: CostSummary;
  refreshError: string | null;
  lastUpdated: Date;
  connected: boolean;
};

const ACTIVE_STATUSES = new Set<RunStatus>(["PENDING", "RUNNING"]);
const POLL_INTERVAL_MS = 3000;

export function ConsoleLive(props: ConsoleLiveProps) {
  const live = useLiveRun(props);
  const t = useTranslations("console");
  return (
    <div className="flex flex-col gap-4 px-4 pb-6 pt-3 lg:px-6">
      {live.refreshError ? (
        <RefreshWarning
          error={live.refreshError}
          lastUpdated={live.lastUpdated}
          onRetry={live.refresh}
        />
      ) : null}
      <Tabs defaultValue="overview">
        <TabsList
          aria-label={t("detailTabs.label")}
          className="w-full justify-start overflow-x-auto"
        >
          <TabsTrigger value="overview">{t("detailTabs.overview")}</TabsTrigger>
          <TabsTrigger value="assets">{t("detailTabs.assets")}</TabsTrigger>
          <TabsTrigger value="runs">{t("detailTabs.runs")}</TabsTrigger>
          <TabsTrigger value="logs">{t("detailTabs.logsAndCosts")}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab live={live} />
        </TabsContent>
        <TabsContent value="assets">
          <AssetsTab live={live} props={props} />
        </TabsContent>
        <TabsContent value="runs">
          <RunHistory
            runs={props.runs}
            selectedRunId={props.runId}
            onSelect={props.onRunSelected}
          />
        </TabsContent>
        <TabsContent value="logs">
          <LogsAndCosts live={live} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function useLiveRun(props: ConsoleLiveProps) {
  const { getRun, getRunCosts, listAssets } = useServices();
  const [state, setState] = useState<LiveState>(() =>
    createInitialState(props),
  );
  const requestId = useRef(0);
  const activeRunId = useRef(props.runId);

  useEffect(() => {
    activeRunId.current = props.runId;
    requestId.current += 1;
    setState(createInitialState(props));
  }, [props.runId]);

  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    const results = await Promise.allSettled([
      getRun(props.runId),
      listAssets(props.taskId),
      getRunCosts(props.runId),
    ]);
    if (
      currentRequest !== requestId.current ||
      activeRunId.current !== props.runId
    )
      return;
    setState((current) => applyRefreshResults(current, results, props));
    const runResult = results[0];
    if (runResult.status === "fulfilled" && runResult.value)
      props.onRunUpdate?.(runResult.value);
  }, [
    getRun,
    getRunCosts,
    listAssets,
    props.onRunUpdate,
    props.runId,
    props.taskId,
    props.taskTitle,
  ]);

  useRunPolling(state.status, refresh);
  useRunEvents(props.runId, refresh, setState);

  useEffect(
    () => props.onStatusChange?.(state.status),
    [props.onStatusChange, state.status],
  );
  return { ...state, refresh };
}

function useRunPolling(status: RunStatus, refresh: () => Promise<void>) {
  useEffect(() => {
    if (!ACTIVE_STATUSES.has(status)) return;
    const timerId = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timerId);
  }, [refresh, status]);
}

function useRunEvents(
  runId: string,
  refresh: () => Promise<void>,
  setState: React.Dispatch<React.SetStateAction<LiveState>>,
) {
  const { locale } = useLocale();
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<PipelineEvent>("pipeline-event", (event) => {
      if (event.payload.run_id !== runId) return;
      setState((current) => applyPipelineEvent(current, event.payload, locale));
      if (event.payload.event !== "log") void refresh();
    })
      .then((dispose) => {
        if (!active) return void dispose();
        unlisten = dispose;
        setState((current) => ({ ...current, connected: true }));
      })
      .catch((error) => {
        if (active)
          setState((current) => ({
            ...current,
            connected: false,
            refreshError: formatError(error),
          }));
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [locale, refresh, runId, setState]);
}

function createInitialState(props: ConsoleLiveProps): LiveState {
  return {
    stages: props.initialStages,
    logs: props.initialLogs,
    status: props.initialStatus,
    assets: props.initialAssets,
    costs: props.initialCostSummary,
    refreshError: null,
    lastUpdated: new Date(),
    connected: false,
  };
}

type RefreshResults = [
  PromiseSettledResult<RunDetail | null>,
  PromiseSettledResult<Asset[]>,
  PromiseSettledResult<CostSummary>,
];

function applyRefreshResults(
  current: LiveState,
  results: RefreshResults,
  props: ConsoleLiveProps,
): LiveState {
  const [runResult, assetResult, costResult] = results;
  const errors = results.flatMap((result) =>
    result.status === "rejected" ? [formatError(result.reason)] : [],
  );
  const detail = runResult.status === "fulfilled" ? runResult.value : null;
  if (runResult.status === "fulfilled" && !runResult.value)
    errors.push(`Run not found: ${props.runId}`);
  return {
    ...current,
    stages: detail ? mapStages(detail, current.stages) : current.stages,
    logs: detail?.logs ?? current.logs,
    status: detail ? (detail.status as RunStatus) : current.status,
    assets:
      assetResult.status === "fulfilled"
        ? toLibraryAssets(assetResult.value, {
            [props.taskId]: props.taskTitle,
          })
        : current.assets,
    costs: costResult.status === "fulfilled" ? costResult.value : current.costs,
    refreshError: errors.length > 0 ? errors.join(" | ") : null,
    lastUpdated: detail ? new Date() : current.lastUpdated,
  };
}

function applyPipelineEvent(
  state: LiveState,
  event: PipelineEvent,
  locale: string,
): LiveState {
  if (event.event === "run")
    return { ...state, status: event.status as RunStatus };
  if (event.event === "stage") {
    const stages = state.stages.map((stage) =>
      stage.type === event.stage
        ? { ...stage, status: event.status as StageStatus }
        : stage,
    );
    return { ...state, stages };
  }
  const log = {
    ts: new Date().toLocaleTimeString(locale, { hour12: false }),
    level: event.level,
    message: event.message,
  };
  return { ...state, logs: [...state.logs, log] };
}

function mapStages(detail: RunDetail, previous: StageSnapshot[]) {
  return detail.stages.map((stage) => ({
    type: stage.stage_type,
    label:
      previous.find((item) => item.type === stage.stage_type)?.label ??
      stage.stage_type,
    status: stage.status as StageStatus,
  }));
}

function OverviewTab({ live }: { live: ReturnType<typeof useLiveRun> }) {
  return (
    <div className="grid gap-4 pt-2 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <StageTimeline status={live.status} stages={live.stages} />
      <FinalOutputPanel status={live.status} assets={live.assets} />
    </div>
  );
}

function AssetsTab({
  live,
  props,
}: {
  live: ReturnType<typeof useLiveRun>;
  props: ConsoleLiveProps;
}) {
  return (
    <div className="pt-2">
      <AssetSections
        assets={live.assets}
        emptyText={props.assetEmptyText}
        signingError={null}
        signingErrorLabel={props.assetSigningErrorLabel}
        statusLabels={props.statusLabels}
        showTaskTitle={false}
      />
    </div>
  );
}

function LogsAndCosts({ live }: { live: ReturnType<typeof useLiveRun> }) {
  return (
    <div className="grid gap-4 pt-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
      <LogPanel
        connected={live.connected}
        logs={live.logs}
        status={live.status}
      />
      <CostPanel summary={live.costs} />
    </div>
  );
}

function RunHistory(props: {
  runs: RunListItem[];
  selectedRunId: string;
  onSelect?: (runId: string) => void;
}) {
  const t = useTranslations("console");
  const { locale } = useLocale();
  return (
    <Card className="mt-2 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-left text-sm">
          <caption className="sr-only">{t("runHistory.caption")}</caption>
          <RunHistoryHead />
          <tbody className="divide-y divide-border">
            {props.runs.map((run) => (
              <RunHistoryRow
                key={run.id}
                locale={locale}
                onSelect={props.onSelect}
                run={run}
                selected={run.id === props.selectedRunId}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function RunHistoryHead() {
  const t = useTranslations("console");
  return (
    <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
      <tr>
        <th className="px-4 py-3">{t("runHistory.run")}</th>
        <th className="px-4 py-3">{t("runHistory.status")}</th>
        <th className="px-4 py-3">{t("runHistory.stage")}</th>
        <th className="px-4 py-3">{t("runHistory.created")}</th>
      </tr>
    </thead>
  );
}

function RunHistoryRow(props: {
  run: RunListItem;
  locale: string;
  selected: boolean;
  onSelect?: (runId: string) => void;
}) {
  const t = useTranslations("console");
  const status = props.run.status as RunStatus;
  return (
    <tr className={cn(props.selected && "bg-muted/40")}>
      <td className="px-4 py-3">
        <button
          className="font-mono text-xs text-foreground transition-colors duration-control hover:text-brand"
          onClick={() => props.onSelect?.(props.run.id)}
          type="button"
        >
          {props.run.id}
        </button>
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={runStatusTone(status)}>
          {t(`statuses.${status}`)}
        </StatusBadge>
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {props.run.current_stage
          ? t(`stages.${props.run.current_stage}`)
          : t("notStarted")}
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {formatDate(props.run.created_at, props.locale)}
      </td>
    </tr>
  );
}

function StageTimeline({
  status,
  stages,
}: {
  status: RunStatus;
  stages: StageSnapshot[];
}) {
  const t = useTranslations("console");
  const progress = getProgress(status, stages);
  return (
    <Card className="h-fit">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>{t("stagesTitle")}</CardTitle>
          <StatusBadge status={runStatusTone(status)}>
            {t(`statuses.${status}`)}
          </StatusBadge>
        </div>
        <div className="flex items-center gap-3">
          <Progress
            value={progress}
            label={t("progressLabel", { value: progress })}
          />
          <span className="text-xs tabular-nums text-muted-foreground">
            {progress}%
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {stages.map((stage, index) => (
          <StageRow index={index + 1} key={stage.type} stage={stage} />
        ))}
      </CardContent>
    </Card>
  );
}

function StageRow({ index, stage }: { index: number; stage: StageSnapshot }) {
  const t = useTranslations("console");
  const Icon = stageIcon(stage.status);
  return (
    <div className="flex items-center gap-3 rounded-md border bg-background/40 p-3">
      <span
        className={cn(
          "flex size-8 items-center justify-center rounded-full bg-muted",
          stageTone(stage.status),
        )}
      >
        <Icon
          className={cn("size-4", stage.status === "RUNNING" && "animate-spin")}
        />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-foreground">
          {stage.label}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t(`stageStatus.${stage.status.toLowerCase()}`)}
        </p>
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">
        {String(index).padStart(2, "0")}
      </span>
    </div>
  );
}

function FinalOutputPanel({
  status,
  assets,
}: {
  status: RunStatus;
  assets: LibraryAsset[];
}) {
  const t = useTranslations("console");
  const { revealAsset } = useServices();
  const finalAsset = assets.find((asset) => asset.type === "FINAL_VIDEO");
  return (
    <Card className="min-h-[260px]">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t("finalOutputTitle")}</CardTitle>
        {finalAsset ? (
          <Button
            onClick={() => void revealAsset(finalAsset.storageKey)}
            size="sm"
            type="button"
            variant="outline"
          >
            {t("openInFolder")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {finalAsset?.url ? (
          <video
            className="aspect-video w-full rounded-md bg-black object-contain"
            controls
            src={finalAsset.url}
          />
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-md border border-dashed bg-muted/30 text-sm text-muted-foreground">
            {status === "COMPLETED"
              ? t("finalOutputUnavailable")
              : t("finalOutputPending")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LogPanel({
  connected,
  logs,
  status,
}: {
  connected: boolean;
  logs: LogSnapshot[];
  status: RunStatus;
}) {
  const t = useTranslations("console");
  return (
    <Card className="min-h-[420px]">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t("liveLog")}</CardTitle>
        <ConnectionState connected={connected} status={status} />
      </CardHeader>
      <CardContent>
        <div className="max-h-[540px] overflow-auto rounded-md border bg-surface-inset p-4 font-mono text-xs">
          {logs.length === 0 ? (
            <span className="text-muted-foreground">{t("noLogs")}</span>
          ) : (
            logs.map((log, index) => (
              <LogLine key={`${log.ts}-${index}`} log={log} />
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function LogLine({ log }: { log: LogSnapshot }) {
  return (
    <div className="grid grid-cols-[72px_56px_minmax(0,1fr)] gap-3 py-1">
      <span className="text-muted-foreground">[{log.ts}]</span>
      <span
        className={cn(
          "font-semibold",
          log.level === "ERROR" ? "text-danger" : "text-muted-foreground",
        )}
      >
        {log.level}
      </span>
      <span className="break-words text-foreground">{log.message}</span>
    </div>
  );
}

function CostPanel({ summary }: { summary: CostSummary }) {
  const t = useTranslations("console");
  return (
    <Card className="h-fit">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t("costsTitle")}</CardTitle>
        <span className="font-semibold tabular-nums">
          {formatUsd(summary.total_cost_usd)}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {summary.incomplete ? (
          <Badge variant="warning">
            <AlertTriangle />
            {t("costIncomplete")}
          </Badge>
        ) : null}
        {summary.providers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noCosts")}</p>
        ) : (
          summary.providers.map((provider) => (
            <ProviderCost
              key={provider.provider}
              provider={provider}
              total={summary.total_cost_usd}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function ProviderCost({
  provider,
  total,
}: {
  provider: CostSummary["providers"][number];
  total: number;
}) {
  const t = useTranslations("console");
  const ratio = total > 0 ? Math.min(1, provider.cost_usd / total) : 0;
  return (
    <div className="rounded-md border p-3">
      <div className="flex justify-between gap-3 text-sm">
        <strong>{provider.provider}</strong>
        <span className="tabular-nums">{formatUsd(provider.cost_usd)}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="motion-progress h-full origin-left bg-brand transition-transform duration-panel"
          style={{ transform: `scaleX(${ratio})` }}
          role="progressbar"
          aria-label={`${provider.provider}: ${Math.round(ratio * 100)}%`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(ratio * 100)}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {t("costUsageMeta", {
          quantity: provider.quantity,
          unit: provider.unit,
          calls: provider.calls,
        })}
      </p>
    </div>
  );
}

function RefreshWarning({
  error,
  lastUpdated,
  onRetry,
}: {
  error: string;
  lastUpdated: Date;
  onRetry: () => Promise<void>;
}) {
  const t = useTranslations("console");
  const { locale } = useLocale();
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm"
      role="status"
    >
      <AlertTriangle className="size-4 text-amber-500" />
      <span className="min-w-0 flex-1">
        {t("refreshWarning", {
          message: error,
          time: lastUpdated.toLocaleTimeString(locale),
        })}
      </span>
      <Button
        onClick={() => void onRetry()}
        size="sm"
        type="button"
        variant="outline"
      >
        <RefreshCw />
        {t("retry")}
      </Button>
    </div>
  );
}

function ConnectionState({
  connected,
  status,
}: {
  connected: boolean;
  status: RunStatus;
}) {
  const t = useTranslations("console");
  const live = ACTIVE_STATUSES.has(status);
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground">
      <span
        className={cn(
          "size-2 rounded-full",
          connected && live ? "bg-success" : "bg-muted-foreground",
        )}
      />
      {connected ? (live ? t("streaming") : t("idle")) : t("disconnected")}
    </span>
  );
}

function getProgress(status: RunStatus, stages: StageSnapshot[]) {
  if (status === "COMPLETED") return 100;
  if (stages.length === 0) return 0;
  return Math.round(
    (stages.filter((stage) => stage.status === "COMPLETED").length /
      stages.length) *
      100,
  );
}

function stageIcon(status: StageStatus) {
  if (status === "COMPLETED") return CheckCircle2;
  if (status === "RUNNING") return Loader2;
  if (status === "FAILED" || status === "CANCELLED") return XCircle;
  return Circle;
}

function stageTone(status: StageStatus) {
  if (status === "COMPLETED") return "text-success";
  if (status === "RUNNING") return "text-brand";
  if (status === "FAILED" || status === "CANCELLED") return "text-danger";
  return "text-muted-foreground";
}

function runStatusTone(status: RunStatus) {
  if (status === "RUNNING") return "running" as const;
  if (status === "COMPLETED") return "success" as const;
  if (status === "FAILED" || status === "CANCELLED") return "error" as const;
  return "neutral" as const;
}

function formatUsd(value: number) {
  return `$${value.toFixed(4)}`;
}
function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
function formatDate(value: string, locale: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(locale, { hour12: false });
}
