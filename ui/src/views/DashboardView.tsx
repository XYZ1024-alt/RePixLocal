import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Clock3,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wallet,
  type LucideIcon
} from "lucide-react";
import { getProviderBalances } from "@/api";
import { BarChart, DonutChart } from "@/components/charts";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "@/i18n/context";
import type { DashboardData, ProviderBalance, ProviderBalanceAccount } from "@/types";

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
  COMPLETED: "#ffffff",
  RUNNING: "#22d3ee",
  FAILED: "#dc2626",
  PENDING: "#71717a",
  PAUSED: "#71717a",
  CANCELLED: "#52525b"
};

const meterClass: Record<ProviderBalance["status"], string> = {
  available: "bg-cyan-400",
  unsupported: "bg-zinc-600",
  not_configured: "bg-zinc-600",
  error: "bg-red-600"
};

type StatCard = {
  label: string;
  value: string | number;
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

type BalanceState = {
  data: ProviderBalance[] | null;
  loading: boolean;
  error: string | null;
};

const balanceStatusVariant: Record<
  ProviderBalance["status"],
  "success" | "warning" | "destructive" | "secondary"
> = {
  available: "success",
  unsupported: "secondary",
  not_configured: "warning",
  error: "destructive"
};

export function DashboardView(props: {
  data: DashboardData | null;
  onNewTask: () => void;
}) {
  const { locale } = useLocale();
  const t = useTranslations("dashboard");
  const tStatus = useTranslations("status");
  const tStages = useTranslations("stages");
  const [balanceState, setBalanceState] = useState<BalanceState>({
    data: null,
    loading: true,
    error: null
  });

  const loadBalance = useCallback(async () => {
    setBalanceState((state) => ({ ...state, loading: true, error: null }));
    try {
      const data = await getProviderBalances();
      setBalanceState({ data, loading: false, error: null });
    } catch (error) {
      setBalanceState({ data: null, loading: false, error: String(error) });
    }
  }, []);

  useEffect(() => {
    void loadBalance();
  }, [loadBalance]);

  if (!props.data) {
    return (
      <>
        <PageHeader title={t("title")} description={t("description")} />
        <div className="px-4 pb-6 pt-3 lg:px-6">
          <EmptyState
            icon={Sparkles}
            title={t("title")}
            description={t("noTasks")}
            action={
              <Button size="sm" onClick={props.onNewTask}>
                <Plus />
                {t("newTask")}
              </Button>
            }
          />
        </div>
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
  const donutSlices = Object.entries(props.data.status_count)
    .filter(([, value]) => value > 0)
    .map(([status, value]) => ({
      label: tStatus(status),
      value,
      color: statusColor[status] ?? "#71717a"
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
      <div className="flex flex-col gap-5 px-4 pb-6 pt-3 animate-fade-in lg:px-6">
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
          <div className="grid gap-5">
            <BalancePanel state={balanceState} onRefresh={loadBalance} />
            <UsagePanel title={t("apiUsageTitle")} emptyText={t("noUsage")} rows={usageRows} />
          </div>
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
      note: t("assetsReady", { count: stats.assets_ready })
    },
    {
      label: t("running"),
      value: stats.running,
      icon: Clock3,
      note: t("livePipelines")
    },
    {
      label: t("completed"),
      value: stats.completed,
      icon: CheckCircle2,
      note: t("completedRuns")
    },
    {
      label: t("successRate"),
      value: `${stats.success_rate}%`,
      icon: ShieldCheck,
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
    <Card interactive className="overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {card.label}
            </span>
            <span className="text-3xl font-bold tabular-nums tracking-tight">{card.value}</span>
          </div>
          <span className="rounded-lg bg-cyan-950/20 p-2.5 ring-1 ring-inset ring-cyan-500/30 shadow-inner">
            <Icon className="size-5 text-cyan-400" />
          </span>
        </div>
        <p className="mt-4 text-xs font-medium text-muted-foreground">{card.note}</p>
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
    <Card className="overflow-hidden">
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
          <EmptyState description={emptyText} />
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
    <Card className="overflow-hidden">
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
        <tbody className="divide-y divide-zinc-800">
          {rows.map((row) => (
            <tr
              key={row.id}
              className="group text-zinc-300 transition-colors hover:bg-cyan-950/20"
            >
              <td className="px-5 py-3.5 font-medium text-foreground">{row.title}</td>
              <td className="px-4 py-3.5 text-muted-foreground">{row.stage}</td>
              <td className="w-44 px-4 py-3.5">
                <ProgressBar value={row.progress} animated={row.status === "RUNNING"} />
              </td>
              <td className="px-5 py-3.5 text-right">
                <Badge
                  variant={statusVariant[row.status] ?? "secondary"}
                  className={
                    row.status === "RUNNING"
                      ? "border-cyan-500/30 bg-cyan-950/30 text-cyan-300 hover:bg-cyan-950/50"
                      : undefined
                  }
                >
                  {row.statusLabel}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BalancePanel({
  state,
  onRefresh
}: {
  state: BalanceState;
  onRefresh: () => void;
}) {
  const t = useTranslations("dashboard");
  const rows = useMemo(() => {
    if (!state.data) return [];
    const values = state.data.map((b) => numericBalance(b.accounts)).filter((v) => v > 0);
    const max = Math.max(1, ...values);
    return state.data.map((balance) => ({
      balance,
      value: (numericBalance(balance.accounts) / max) * 100
    }));
  }, [state.data]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-cyan-950/20 ring-1 ring-inset ring-cyan-500/30">
            <Wallet className="size-4 text-cyan-400" />
          </span>
          <CardTitle>{t("balanceTitle")}</CardTitle>
        </div>
        <Button
          aria-label={t("refreshBalance")}
          disabled={state.loading}
          onClick={onRefresh}
          size="icon"
          title={t("refreshBalance")}
          type="button"
          variant="outline"
        >
          <RefreshCw className={cn("transition-transform", state.loading && "animate-spin")} />
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {state.loading && !state.data ? <BalanceSkeleton /> : null}
        {state.error ? (
          <div className="rounded-lg border border-red-900/50 bg-red-950/40 p-3">
            <p className="break-words text-xs leading-relaxed text-red-200">
              {t("balanceError", { message: state.error })}
            </p>
          </div>
        ) : null}
        {state.data ? (
          <div className="flex flex-col gap-4">
            {rows.length > 0 ? (
              rows.map(({ balance, value }) => (
                <BalanceMeter key={balance.provider} balance={balance} relativeValue={value} />
              ))
            ) : (
              <EmptyRow text={t("noUsage")} />
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function BalanceMeter({
  balance,
  relativeValue
}: {
  balance: ProviderBalance;
  relativeValue: number;
}) {
  const { locale } = useLocale();
  const t = useTranslations("dashboard");
  const checkedAt = formatCheckedAt(balance.checked_at, locale);
  const message = providerBalanceMessage(balance, t);

  return (
    <div className="group flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">{providerBalanceLabel(balance.provider)}</span>
          <Badge variant={balanceStatusVariant[balance.status]}>
            {t(`balanceStatus.${balance.status}`)}
          </Badge>
        </div>
        <span className="text-muted-foreground">{checkedAt}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-950 ring-1 ring-inset ring-zinc-800">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-700",
            meterClass[balance.status]
          )}
          style={{ width: `${Math.max(relativeValue, MIN_PROGRESS)}%` }}
        />
      </div>
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
      {balance.accounts.length > 0 ? (
        <div className="mt-1 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {balance.accounts.map((account) => (
            <BalanceAccount key={`${balance.provider}-${account.currency}`} info={account} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BalanceAccount({ info }: { info: ProviderBalanceAccount }) {
  const t = useTranslations("dashboard");

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 transition-colors hover:border-cyan-500/50 hover:bg-cyan-950/20">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{t("balanceCurrency")}</span>
        <span className="text-xs font-semibold">{info.currency}</span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <BalanceAmount label={t("balanceTotal")} value={info.total_balance} />
        {info.granted_balance ? (
          <BalanceAmount label={t("balanceGranted")} value={info.granted_balance} />
        ) : null}
        {info.topped_up_balance ? (
          <BalanceAmount label={t("balanceToppedUp")} value={info.topped_up_balance} />
        ) : null}
      </div>
    </div>
  );
}

function BalanceAmount({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function BalanceSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="h-4 w-24 rounded bg-zinc-800/60 animate-pulse" />
            <span className="h-4 w-16 rounded bg-zinc-800/60 animate-pulse" />
          </div>
          <div className="h-2 rounded-full bg-zinc-800/60 animate-pulse" />
          <div className="h-3 w-32 rounded bg-zinc-800/60 animate-pulse" />
        </div>
      ))}
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
    <Card className="overflow-hidden">
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
    <div className="group flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-foreground">{row.provider}</span>
        <span className="text-muted-foreground">{row.meta}</span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-zinc-950 ring-1 ring-inset ring-zinc-800">
        <div
          className="h-full rounded-full bg-cyan-400 transition-all duration-700 group-hover:bg-cyan-300"
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
    </div>
  );
}

function ProgressBar({ value, animated }: { value: number; animated?: boolean }) {
  const width = Math.min(value, 100);

  return (
    <div className="relative h-2 overflow-hidden rounded-full bg-zinc-950 ring-1 ring-inset ring-zinc-800">
      <div
        className={cn(
          "h-full rounded-full transition-all duration-500",
          animated ? "bg-cyan-400 animate-pulse-glow shadow-glow" : "bg-cyan-400"
        )}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="px-5 py-6">
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function providerBalanceLabel(provider: string) {
  const labels: Record<string, string> = {
    DASHSCOPE: "DashScope",
    DEEPSEEK: "DeepSeek",
    SEEDANCE: "Seedance"
  };
  return labels[provider] ?? provider;
}

function providerBalanceMessage(
  balance: ProviderBalance,
  t: (key: string, values?: Record<string, string | number>) => string
) {
  if (balance.status === "unsupported" && balance.provider === "DASHSCOPE") {
    return t("balanceUnsupportedDashscope");
  }
  if (balance.status === "unsupported" && balance.provider === "SEEDANCE") {
    return t("balanceUnsupportedSeedance");
  }
  if (balance.status === "not_configured") {
    return t("balanceNotConfigured", { provider: providerBalanceLabel(balance.provider) });
  }
  if (balance.status === "error") {
    return balance.message ?? t("balanceStatus.error");
  }
  return null;
}

function formatCheckedAt(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function parseNumeric(value: string): number {
  const cleaned = value.replace(/[^\d.]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numericBalance(accounts: ProviderBalanceAccount[]): number {
  return accounts.reduce((sum, account) => sum + parseNumeric(account.total_balance), 0);
}
