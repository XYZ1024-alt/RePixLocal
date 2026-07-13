import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  type LucideIcon
} from "lucide-react";
import type { DashboardData, TaskFilter } from "@/types";

export type DashboardTranslator = (
  key: string,
  values?: Record<string, string | number>
) => string;

export type DashboardStatCard = {
  label: string;
  value: string | number;
  icon: LucideIcon;
  note: string;
  filter: TaskFilter;
};

export type DashboardQueueRow = {
  id: string;
  title: string;
  stage: string;
  progress: number;
  status: string;
  statusLabel: string;
};

export type DashboardUsageRow = {
  provider: string;
  quantity: number;
  meta: string;
};

export type DashboardTrendPoint = {
  label: string;
  value: number;
};

export type DashboardStatusSlice = {
  label: string;
  value: number;
  color: string;
};

export type DashboardModel = {
  cards: DashboardStatCard[];
  queueRows: DashboardQueueRow[];
  usageRows: DashboardUsageRow[];
  trend: DashboardTrendPoint[];
  statusSlices: DashboardStatusSlice[];
};

type BuildDashboardModelOptions = {
  data: DashboardData;
  locale: string;
  t: DashboardTranslator;
  tStages: DashboardTranslator;
  tStatus: DashboardTranslator;
};

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: "var(--success)",
  RUNNING: "var(--brand)",
  FAILED: "var(--danger)",
  PENDING: "var(--muted-foreground)",
  PAUSED: "var(--warning)",
  CANCELLED: "var(--muted-foreground)"
};

const ATTENTION_STATUSES = ["FAILED", "DRAFT", "CANCELLED", "CANCELED", "PAUSED"];

export function buildDashboardModel({
  data,
  locale,
  t,
  tStages,
  tStatus
}: BuildDashboardModelOptions): DashboardModel {
  return {
    cards: createStatCards(data, t),
    queueRows: createQueueRows({ data, t, tStages, tStatus }),
    usageRows: createUsageRows(data, t),
    trend: createTrend(data, locale),
    statusSlices: createStatusSlices(data, tStatus)
  };
}

function createStatCards(data: DashboardData, t: DashboardTranslator): DashboardStatCard[] {
  const attentionCount = ATTENTION_STATUSES.reduce(
    (total, status) => total + (data.status_count[status] ?? 0),
    0
  );

  return [
    {
      label: t("totalTasks"),
      value: data.stats.total_tasks,
      icon: Activity,
      note: t("assetsReady", { count: data.stats.assets_ready }),
      filter: "all"
    },
    {
      label: t("running"),
      value: data.stats.running,
      icon: Clock3,
      note: t("livePipelines"),
      filter: "running"
    },
    {
      label: t("completed"),
      value: data.stats.completed,
      icon: CheckCircle2,
      note: t("completedRuns"),
      filter: "completed"
    },
    {
      label: t("needsAttention"),
      value: attentionCount,
      icon: AlertTriangle,
      note: t("needsAttentionNote"),
      filter: "attention"
    }
  ];
}

function createQueueRows({
  data,
  t,
  tStages,
  tStatus
}: Omit<BuildDashboardModelOptions, "locale">): DashboardQueueRow[] {
  return data.queue.map((row) => ({
    id: row.id,
    title: row.title,
    stage: row.current_stage ? tStages(row.current_stage) : t("pending"),
    progress: row.progress,
    status: row.status,
    statusLabel: tStatus(row.status)
  }));
}

function createUsageRows(
  data: DashboardData,
  t: DashboardTranslator
): DashboardUsageRow[] {
  return data.usage.map((row) => ({
    provider: row.provider,
    quantity: row.quantity,
    meta:
      row.unknown_cost_count > 0
        ? t("usageMetaUnknownCost", {
            quantity: row.quantity.toLocaleString(),
            calls: row.calls.toLocaleString(),
            unknown: row.unknown_cost_count.toLocaleString()
          })
        : t("usageMeta", {
            quantity: row.quantity.toLocaleString(),
            calls: row.calls.toLocaleString(),
            cost: `$${row.cost_usd.toFixed(4)}`
          })
  }));
}

function createTrend(data: DashboardData, locale: string): DashboardTrendPoint[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: "short" });
  return data.trend.map((point) => ({
    label: formatter.format(new Date(point.date)),
    value: point.value
  }));
}

function createStatusSlices(
  data: DashboardData,
  tStatus: DashboardTranslator
): DashboardStatusSlice[] {
  return Object.entries(data.status_count)
    .filter(([, value]) => value > 0)
    .map(([status, value]) => ({
      label: tStatus(status),
      value,
      color: STATUS_COLORS[status] ?? "var(--muted-foreground)"
    }));
}
