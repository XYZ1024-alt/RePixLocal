import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  Circle,
  Loader2,
  PlayCircle,
  XCircle
} from "lucide-react";
import { listRuns } from "@/api";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
  COMPLETED: "text-emerald-300",
  RUNNING: "text-blue-300",
  PENDING: "text-muted-foreground",
  PAUSED: "text-muted-foreground",
  FAILED: "text-red-300",
  CANCELLED: "text-red-300"
};

const statusBadge: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
  COMPLETED: "success",
  RUNNING: "warning",
  PENDING: "secondary",
  PAUSED: "secondary",
  FAILED: "destructive",
  CANCELLED: "destructive"
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
          <Card>
            <CardContent className="p-5 text-sm text-muted-foreground">{t("noRuns")}</CardContent>
          </Card>
        ) : runs.length === 0 ? (
          <EmptyConsole text={t("empty")} />
        ) : (
          runs.map((run) => (
            <RunRow
              key={run.id}
              title={run.title}
              stage={run.current_stage ? tStages(run.current_stage) : t("notStarted")}
              createdAt={formatCreatedAt(run.created_at, locale)}
              status={run.status}
              statusLabel={tStatus(run.status as RunStatus)}
              onOpen={() => props.onOpenRun(run.id)}
            />
          ))
        )}
      </div>
    </>
  );
}

function RunRow({
  title,
  stage,
  createdAt,
  status,
  statusLabel,
  onOpen
}: {
  title: string;
  stage: string;
  createdAt: string;
  status: string;
  statusLabel: string;
  onOpen: () => void;
}) {
  const Icon = statusIcon[status] ?? Circle;

  return (
    <button className="w-full text-left" onClick={onOpen} type="button">
      <Card className="transition-colors hover:border-blue-400/40 hover:bg-card">
        <CardContent className="flex items-center gap-4 p-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/[0.05] ring-1 ring-white/10">
            <Icon
              className={cn(
                "size-5",
                statusColor[status] ?? "text-muted-foreground",
                status === "RUNNING" && "animate-spin"
              )}
            />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate text-sm font-semibold">{title}</span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <PlayCircle className="size-3.5" />
              {stage} - {createdAt}
            </span>
          </div>
          <Badge variant={statusBadge[status] ?? "secondary"}>{statusLabel}</Badge>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </CardContent>
      </Card>
    </button>
  );
}

function EmptyConsole({ text }: { text: string }) {
  return (
    <Card>
      <CardContent className="p-5 text-sm text-muted-foreground">{text}</CardContent>
    </Card>
  );
}

function formatCreatedAt(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale, { hour12: false });
}