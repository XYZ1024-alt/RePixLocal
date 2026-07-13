import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Inbox,
  RefreshCw,
  Search,
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { useLocale, useTranslations } from "@/i18n/context";
import {
  filterTaskSummaries,
  type TaskFilter,
  type TaskSummary,
} from "@/features/tasks/task-model";
import { useTaskSummaries } from "@/features/tasks/use-task-summaries";

export type { TaskFilter } from "@/features/tasks/task-model";

const FILTERS: TaskFilter[] = ["all", "running", "attention", "completed"];

export function TasksView(props: {
  initialFilter?: TaskFilter;
  onOpenTask: (taskId: string, runId: string | null) => void;
}) {
  const t = useTranslations("tasks");
  const [filter, setFilter] = useState<TaskFilter>(
    props.initialFilter ?? "all",
  );
  const [search, setSearch] = useState("");
  const state = useTaskSummaries();
  const visible = useMemo(
    () => filterTaskSummaries(state.summaries, filter, search),
    [filter, search, state.summaries],
  );

  useEffect(() => {
    if (props.initialFilter) setFilter(props.initialFilter);
  }, [props.initialFilter]);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <main className="flex flex-col gap-4 px-4 pb-6 pt-3 lg:px-6">
        <TaskToolbar
          filter={filter}
          search={search}
          onFilter={setFilter}
          onSearch={setSearch}
        />
        <TaskListState
          state={state}
          visible={visible}
          onOpenTask={props.onOpenTask}
        />
      </main>
    </>
  );
}

function TaskToolbar(props: {
  filter: TaskFilter;
  search: string;
  onFilter: (filter: TaskFilter) => void;
  onSearch: (search: string) => void;
}) {
  const t = useTranslations("tasks");
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative w-full sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label={t("searchLabel")}
          className="pl-9"
          onChange={(event) => props.onSearch(event.target.value)}
          placeholder={t("searchPlaceholder")}
          type="search"
          value={props.search}
        />
      </div>
      <SegmentedControl
        aria-label={t("filterLabel")}
        onValueChange={props.onFilter}
        options={FILTERS.map((item) => ({
          value: item,
          label: t(`filters.${item}`),
        }))}
        value={props.filter}
      />
    </div>
  );
}

function TaskListState(props: {
  state: ReturnType<typeof useTaskSummaries>;
  visible: TaskSummary[];
  onOpenTask: (taskId: string, runId: string | null) => void;
}) {
  const t = useTranslations("tasks");
  if (props.state.loading && !props.state.hasLoaded)
    return <TasksSkeleton />;
  if (props.state.error && !props.state.hasLoaded) {
    return (
      <InitialError error={props.state.error} onRetry={props.state.refresh} />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {props.state.error ? (
        <RefreshWarning
          error={props.state.error}
          lastUpdated={props.state.lastUpdated}
          onRetry={props.state.refresh}
        />
      ) : null}
      {props.visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={Inbox}
            description={t(
              props.state.summaries.length === 0 ? "empty" : "emptyFiltered",
            )}
          />
        </Card>
      ) : (
        <TasksTable summaries={props.visible} onOpenTask={props.onOpenTask} />
      )}
    </div>
  );
}

function TasksTable(props: {
  summaries: TaskSummary[];
  onOpenTask: (taskId: string, runId: string | null) => void;
}) {
  const t = useTranslations("tasks");
  const { locale } = useLocale();
  const columns = getTaskColumns(t, locale);
  return (
    <Card className="overflow-hidden">
      <DataTable
        caption={t("table.caption")}
        columns={columns}
        data={props.summaries}
        getRowKey={(summary) => summary.task.id}
        onRowClick={(summary) =>
          props.onOpenTask(summary.task.id, summary.latestRun?.id ?? null)
        }
      />
    </Card>
  );
}

function getTaskColumns(
  t: (key: string) => string,
  locale: string,
): DataTableColumn<TaskSummary>[] {
  return [
    {
      key: "task",
      header: t("table.task"),
      render: (summary) => <TaskName summary={summary} />,
    },
    {
      key: "status",
      header: t("table.status"),
      render: (summary) => <TaskStatus status={summary.status} />,
    },
    {
      key: "stage",
      header: t("table.stage"),
      className: "max-w-[220px] truncate text-muted-foreground",
      render: (summary) => <TaskStage summary={summary} />,
    },
    {
      key: "runs",
      header: t("table.runs"),
      className: "tabular-nums text-muted-foreground",
      render: (summary) => summary.runs.length,
    },
    {
      key: "updated",
      header: t("table.updated"),
      className: "whitespace-nowrap text-muted-foreground",
      render: (summary) => formatDate(summary.updatedAt, locale),
    },
    {
      key: "actions",
      header: t("table.actions"),
      className: "text-right",
      render: () => (
        <ChevronRight
          className="ml-auto size-4 text-muted-foreground"
          aria-hidden="true"
        />
      ),
    },
  ];
}

function TaskName({ summary }: { summary: TaskSummary }) {
  return (
    <span className="block max-w-[320px] truncate font-semibold">
      {summary.task.title}
    </span>
  );
}

function TaskStage({ summary }: { summary: TaskSummary }) {
  const t = useTranslations("tasks");
  return (
    <>
      {summary.currentStage
        ? t(`stages.${summary.currentStage}`)
        : t("notStarted")}
    </>
  );
}

function TaskStatus({ status }: { status: string }) {
  const t = useTranslations("tasks");
  return (
    <StatusBadge status={statusTone(status)}>
      {t(`statuses.${status}`)}
    </StatusBadge>
  );
}

function RefreshWarning(props: {
  error: string;
  lastUpdated: Date | null;
  onRetry: () => Promise<void>;
}) {
  const { locale } = useLocale();
  const t = useTranslations("tasks");
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm"
      role="status"
    >
      <AlertTriangle className="size-4 text-warning" />
      <span className="min-w-0 flex-1">
        {t("refreshError", {
          message: props.error,
          time: props.lastUpdated
            ? props.lastUpdated.toLocaleTimeString(locale)
            : t("never"),
        })}
      </span>
      <Button
        onClick={() => void props.onRetry()}
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

function InitialError({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => Promise<void>;
}) {
  const t = useTranslations("tasks");
  return (
    <Card>
      <EmptyState
        icon={AlertTriangle}
        title={t("loadError")}
        description={error}
        action={
          <Button
            onClick={() => void onRetry()}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCw />
            {t("retry")}
          </Button>
        }
      />
    </Card>
  );
}

function TasksSkeleton() {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton className="h-12 w-full rounded-md" key={index} />
        ))}
      </CardContent>
    </Card>
  );
}

function statusTone(status: string): StatusTone {
  if (status === "RUNNING") return "running";
  if (status === "COMPLETED") return "success";
  if (["FAILED", "CANCELLED", "CANCELED"].includes(status)) return "error";
  if (status === "DRAFT" || status === "PAUSED") return "warning";
  return "neutral";
}

function formatDate(value: string, locale: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(locale, { hour12: false });
}
