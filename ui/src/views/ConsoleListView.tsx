import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  Circle,
  Inbox,
  Loader2,
  PlayCircle,
  XCircle
} from "lucide-react";
import { listRuns } from "@/api";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale, useTranslations } from "@/i18n/context";
import { cn } from "@/lib/utils";
import type { RunListItem } from "@/types";

type RunStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "PAUSED" | "CANCELLED";

const statusIcon: Record<string, typeof Circle> = {
  COMPLETED: CheckCircle2,
  RUNNING: Loader2,
  PENDING: Circle,
  PAUSED: Circle,
  FAILED: XCircle,
  CANCELLED: XCircle
};

const statusColor: Record<string, string> = {
  COMPLETED: "text-white",
  RUNNING: "text-cyan-300",
  PENDING: "text-zinc-400",
  PAUSED: "text-zinc-400",
  FAILED: "text-red-200",
  CANCELLED: "text-red-200"
};

const statusBadge: Record<string, "default" | "success" | "warning" | "destructive" | "secondary"> = {
  COMPLETED: "success",
  RUNNING: "default",
  PENDING: "secondary",
  PAUSED: "secondary",
  FAILED: "destructive",
  CANCELLED: "destructive"
};

const statusBarColor: Record<string, string> = {
  COMPLETED: "bg-white",
  RUNNING: "bg-cyan-400 animate-pulse",
  PENDING: "bg-zinc-500",
  PAUSED: "bg-zinc-500",
  FAILED: "bg-red-400",
  CANCELLED: "bg-red-400"
};

export function ConsoleListView(props: { onOpenRun: (runId: string) => void }) {
  const { locale } = useLocale();
  const t = useTranslations("console");
  const tStatus = useTranslations("status");
  const tStages = useTranslations("stages");
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const nextRuns = await listRuns(100);
        if (active) setRuns(nextRuns);
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    const id = window.setInterval(() => {
      void listRuns(100).then((nextRuns) => {
        if (active) setRuns(nextRuns);
      });
    }, 3000);

    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  return (
    <>
      <PageHeader title={t("title")} description={t("listDescription")} />
      <div className="flex flex-col gap-3 px-4 pb-6 pt-3 lg:px-6">
        {loading ? (
          <ConsoleListSkeleton />
        ) : runs.length === 0 ? (
          <Card>
            <EmptyState icon={Inbox} description={t("empty")} />
          </Card>
        ) : (
          runs.map((run, index) => (
            <RunRow
              key={run.id}
              title={run.title}
              stage={run.current_stage ? tStages(run.current_stage) : t("notStarted")}
              createdAt={formatCreatedAt(run.created_at, locale)}
              status={run.status}
              statusLabel={tStatus(run.status as RunStatus)}
              onOpen={() => props.onOpenRun(run.id)}
              index={index}
            />
          ))
        )}
      </div>
    </>
  );
}

function ConsoleListSkeleton() {
  return (
    <div className="flex flex-col gap-3 animate-fade-in">
      {Array.from({ length: 5 }).map((_, index) => (
        <Card key={index}>
          <CardContent className="flex items-center gap-4 p-4">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-5 w-16 rounded-md" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function RunRow({
  title,
  stage,
  createdAt,
  status,
  statusLabel,
  onOpen,
  index
}: {
  title: string;
  stage: string;
  createdAt: string;
  status: string;
  statusLabel: string;
  onOpen: () => void;
  index: number;
}) {
  const Icon = statusIcon[status] ?? Circle;

  return (
    <button
      className="w-full text-left animate-slide-up"
      onClick={onOpen}
      type="button"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <Card interactive className="group relative overflow-hidden">
        <span
          className={cn(
            "absolute inset-y-0 left-0 w-1 rounded-l-xl",
            statusBarColor[status] ?? "bg-zinc-500"
          )}
        />
        <CardContent className="flex items-center gap-4 p-4 pl-5">
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-full bg-zinc-900 ring-1 ring-zinc-800 transition-all duration-200 group-hover:ring-cyan-500/40",
              status === "RUNNING" && "bg-cyan-950/30 ring-cyan-500/30",
              status === "COMPLETED" && "bg-zinc-800 ring-zinc-700",
              (status === "FAILED" || status === "CANCELLED") && "bg-red-950/40 ring-red-900/50"
            )}
          >
            <Icon
              className={cn(
                "size-5 transition-colors duration-200",
                statusColor[status] ?? "text-zinc-400",
                status === "RUNNING" && "animate-spin"
              )}
            />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate text-sm font-semibold text-white transition-colors group-hover:text-cyan-300">
              {title}
            </span>
            <span className="flex items-center gap-2 text-xs text-zinc-400">
              <PlayCircle className="size-3.5 text-cyan-400" />
              {stage} - {createdAt}
            </span>
          </div>
          <Badge variant={statusBadge[status] ?? "secondary"}>{statusLabel}</Badge>
          <ChevronRight className="size-4 shrink-0 text-zinc-400 transition-colors duration-200 group-hover:text-cyan-300" />
        </CardContent>
      </Card>
    </button>
  );
}

function formatCreatedAt(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale, { hour12: false });
}
