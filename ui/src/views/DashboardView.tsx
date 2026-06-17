import {
  Activity,
  CheckCircle2,
  Clock3,
  Plus,
  ShieldCheck,
  type LucideIcon
} from "lucide-react";
import { BarChart, DonutChart } from "@/components/charts";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocale, useTranslations } from "@/i18n/context";
import type { DashboardData } from "@/types";

const MIN_PROGRESS = 3;

const statusVariant: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
  COMPLETED: "success",
  RUNNING: "warning",
  FAILED: "destructive",
  PENDING: "secondary",
  PAUSED: "secondary",
  CANCELLED: "secondary"
};

const statusColor: Record<string, string> = {
  COMPLETED: "#10b981",
  RUNNING: "#22d3ee",
  FAILED: "#ef4444",
  PENDING: "#3b82f6",
  PAUSED: "#64748b",
  CANCELLED: "#475569"
};

type StatCard = {
  label: string;
  value: string | number;
  accent: string;
  icon: LucideIcon;
  note: string;
};

type QueueRow = {
  id: string;
  title: string;
  stage: string;
  progress: number;
  status: string;
  statusLabel: string;
};

type UsageRow = {
  provider: string;
  quantity: number;
  meta: string;
};

export function DashboardView(props: {
  data: DashboardData | null;
  onNewTask: () => void;
}) {
  const { locale } = useLocale();
  const t = useTranslations("dashboard");
  const tStatus = useTranslations("status");
  const tStages = useTranslations("stages");

  if (!props.data) {
    return (
      <>
        <PageHeader title={t("title")} description={t("description")} />
        <div className="px-4 pb-6 pt-3 text-sm text-muted-foreground lg:px-6">{t("noTasks")}</div>
      </>
    );
  }

  const cards = getStatCards(props.data.stats, t);
  const queueRows = props.data.queue.map((row) => ({
    id: row.id,
    title: row.title,
    stage: row.current_stage ? tStages(row.current_stage) : t("pending"),
    progress: row.progress,
    status: row.status,
    statusLabel: tStatus(row.status)
  }));
  const usageRows = props.data.usage.map((row) => ({
    provider: row.provider,
    quantity: row.quantity,
    meta: t("usageMeta", {
      quantity: row.quantity.toLocaleString(),
      calls: row.calls.toLocaleString(),
      cost: `$${row.cost_usd.toFixed(4)}`
    })
  }));
  const donutSlices = Object.entries(props.data.status_count)
    .filter(([, value]) => value > 0)
    .map(([status, value]) => ({
      label: tStatus(status),
      value,
      color: statusColor[status] ?? "#64748b"
    }));
  const trend = props.data.trend.map((point) => ({
    label: new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(point.date)),
    value: point.value
  }));

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button size="sm" onClick={props.onNewTask}>
            <Plus />
            {t("newTask")}
          </Button>
        }
      />
      <div className="flex flex-col gap-5 px-4 pb-6 pt-3 lg:px-6">
        <StatGrid cards={cards} />
        <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
          <TrendPanel title={t("trendTitle")} rangeLabel={t("sevenDays")} data={trend} />
          <StatusPanel
            title={t("statusTitle")}
            emptyText={t("noTasks")}
            centerLabel={t("centerLabel")}
            slices={donutSlices}
          />
        </div>
        <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
          <QueuePanel title={t("queueTitle")} emptyText={t("noRuns")} rows={queueRows} />
          <UsagePanel title={t("apiUsageTitle")} emptyText={t("noUsage")} rows={usageRows} />
        </div>
      </div>
    </>
  );
}

function getStatCards(stats: DashboardData["stats"], t: (key: string, values?: Record<string, string | number>) => string): StatCard[] {
  return [
    {
      label: t("totalTasks"),
      value: stats.total_tasks,
      icon: Activity,
      accent: "text-cyan-300",
      note: t("assetsReady", { count: stats.assets_ready })
    },
    {
      label: t("running"),
      value: stats.running,
      icon: Clock3,
      accent: "text-violet-300",
      note: t("livePipelines")
    },
    {
      label: t("completed"),
      value: stats.completed,
      icon: CheckCircle2,
      accent: "text-blue-300",
      note: t("completedRuns")
    },
    {
      label: t("successRate"),
      value: `${stats.success_rate}%`,
      icon: ShieldCheck,
      accent: "text-emerald-300",
      note: t("qualitySignal")
    }
  ];
}

function StatGrid({ cards }: { cards: StatCard[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <MetricCard key={card.label} card={card} />
      ))}
    </div>
  );
}

function MetricCard({ card }: { card: StatCard }) {
  const Icon = card.icon;

  return (
    <Card className="overflow-hidden bg-gradient-to-br from-white/[0.06] to-transparent">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-3">
            <span className="text-xs font-semibold text-muted-foreground">{card.label}</span>
            <span className="text-3xl font-semibold tabular-nums">{card.value}</span>
          </div>
          <span className="rounded-md bg-white/[0.05] p-2 ring-1 ring-white/10">
            <Icon className={`size-4 ${card.accent}`} />
          </span>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">{card.note}</p>
      </CardContent>
    </Card>
  );
}

function TrendPanel({
  title,
  rangeLabel,
  data
}: {
  title: string;
  rangeLabel: string;
  data: { label: string; value: number }[];
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-3">
        <CardTitle>{title}</CardTitle>
        <Badge variant="outline">{rangeLabel}</Badge>
      </CardHeader>
      <CardContent>
        <BarChart data={data} />
      </CardContent>
    </Card>
  );
}

function StatusPanel({
  title,
  emptyText,
  centerLabel,
  slices
}: {
  title: string;
  emptyText: string;
  centerLabel: string;
  slices: { label: string; value: number; color: string }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {slices.length > 0 ? (
          <DonutChart slices={slices} centerLabel={centerLabel} />
        ) : (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        )}
      </CardContent>
    </Card>
  );
}

function QueuePanel({
  title,
  emptyText,
  rows
}: {
  title: string;
  emptyText: string;
  rows: QueueRow[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length > 0 ? <QueueTable rows={rows} /> : <EmptyRow text={emptyText} />}
      </CardContent>
    </Card>
  );
}

function QueueTable({ rows }: { rows: QueueRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <tbody className="divide-y divide-white/[0.06]">
          {rows.map((row) => (
            <tr key={row.id} className="text-slate-300">
              <td className="px-5 py-3 font-medium text-foreground">{row.title}</td>
              <td className="px-4 py-3 text-muted-foreground">{row.stage}</td>
              <td className="w-40 px-4 py-3">
                <ProgressBar value={row.progress} />
              </td>
              <td className="px-5 py-3 text-right">
                <Badge variant={statusVariant[row.status] ?? "secondary"}>{row.statusLabel}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UsagePanel({
  title,
  emptyText,
  rows
}: {
  title: string;
  emptyText: string;
  rows: UsageRow[];
}) {
  const max = Math.max(1, ...rows.map((row) => row.quantity));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {rows.length > 0 ? (
          rows.map((row) => <UsageMeter key={row.provider} row={row} max={max} />)
        ) : (
          <EmptyRow text={emptyText} />
        )}
      </CardContent>
    </Card>
  );
}

function UsageMeter({ row, max }: { row: UsageRow; max: number }) {
  const value = Math.max((row.quantity / max) * 100, MIN_PROGRESS);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-slate-200">{row.provider}</span>
        <span className="text-muted-foreground">{row.meta}</span>
      </div>
      <ProgressBar value={value} />
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
      <div
        className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400"
        style={{ width: `${Math.min(value, 100)}%` }}
      />
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="px-5 py-4 text-sm text-muted-foreground">{text}</p>;
}