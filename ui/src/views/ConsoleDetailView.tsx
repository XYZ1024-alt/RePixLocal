import { useEffect, useState } from "react";
import { ArrowLeft, Inbox, XCircle } from "lucide-react";
import { cancelTask, getRun, getRunCosts, listAssets, resumeTask } from "@/api";
import { ConsoleLive, type LogSnapshot, type StageSnapshot } from "@/components/ConsoleLive";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslations } from "@/i18n/context";
import { toLibraryAssets, type LibraryAsset } from "@/lib/library";
import type { CostSummary, RunDetail } from "@/types";

type RunStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

type LoadedDetail = {
  detail: RunDetail;
  costSummary: CostSummary;
  assets: LibraryAsset[];
};

export function ConsoleDetailView(props: {
  runId: string | null;
  onBack: () => void;
  onResumed?: (runId: string) => void;
}) {
  const t = useTranslations("console");
  const tStages = useTranslations("stages");
  const tStatus = useTranslations("status");
  const [loaded, setLoaded] = useState<LoadedDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    if (!props.runId) {
      setLoaded(null);
      setLoading(false);
      setError(null);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        const run = await getRun(props.runId!);
        if (!active) return;
        if (!run) {
          setLoaded(null);
          setError(t("empty"));
          return;
        }

        const [costs, assetRows] = await Promise.all([
          getRunCosts(props.runId!),
          listAssets(run.task_id)
        ]);
        if (!active) return;

        setLoaded({
          detail: run,
          costSummary: costs,
          assets: toLibraryAssets(assetRows, { [run.task_id]: run.task_title })
        });
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [props.runId, t]);

  if (!props.runId) {
    return (
      <>
        <PageHeader title={t("title")} description={t("notStarted")} />
        <div className="px-4 pb-6 lg:px-6">
          <Card>
            <EmptyState icon={Inbox} description={t("empty")} />
          </Card>
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <PageHeader
          title={t("title")}
          description={props.runId}
          actions={<BackButton label={t("backToList")} onBack={props.onBack} />}
        />
        <div className="px-4 pb-6 lg:px-6">
          <ConsoleDetailSkeleton />
        </div>
      </>
    );
  }

  if (error || !loaded) {
    return (
      <>
        <PageHeader
          title={t("title")}
          description={props.runId}
          actions={<BackButton label={t("backToList")} onBack={props.onBack} />}
        />
        <div className="px-4 pb-6 lg:px-6">
          <Card className="border-red-900/50 bg-red-950/40">
            <div className="flex flex-col items-center justify-center gap-3 px-5 py-10 text-center animate-fade-in">
              <XCircle className="size-12 text-red-400" />
              <p className="max-w-xs text-xs leading-relaxed text-red-200">
                {error ?? t("empty")}
              </p>
            </div>
          </Card>
        </div>
      </>
    );
  }

  const { detail, costSummary, assets } = loaded;
  const runStatus = detail.status as RunStatus;
  const canCancel = runStatus === "RUNNING";
  const canResume = runStatus === "FAILED" || runStatus === "CANCELLED";

  async function handleCancel() {
    setActionBusy(true);
    setError(null);
    try {
      await cancelTask(detail.task_id);
      const run = await getRun(detail.id);
      if (run) {
        setLoaded({
          detail: run,
          costSummary,
          assets
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionBusy(false);
    }
  }

  async function handleResume() {
    setActionBusy(true);
    setError(null);
    try {
      const response = await resumeTask(detail.task_id);
      props.onResumed?.(response.run_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionBusy(false);
    }
  }

  const initialStages: StageSnapshot[] = detail.stages.map((stage) => ({
    type: stage.stage_type,
    label: tStages(stage.stage_type),
    status: stage.status as StageSnapshot["status"]
  }));

  return (
    <>
      <PageHeader
        title={detail.task_title}
        description={detail.task_id}
        actions={
          <div className="flex items-center gap-2">
            {canCancel ? (
              <Button
                disabled={actionBusy}
                onClick={() => void handleCancel()}
                size="sm"
                type="button"
                variant="outline"
              >
                {t("cancelRun")}
              </Button>
            ) : null}
            {canResume ? (
              <Button
                disabled={actionBusy}
                onClick={() => void handleResume()}
                size="sm"
                type="button"
              >
                {t("resumeRun")}
              </Button>
            ) : null}
            <BackButton label={t("backToList")} onBack={props.onBack} />
          </div>
        }
      />
      <ConsoleLive
        runId={detail.id}
        taskId={detail.task_id}
        taskTitle={detail.task_title}
        initialStages={initialStages}
        initialLogs={detail.logs as LogSnapshot[]}
        initialStatus={detail.status as RunStatus}
        initialAssets={assets}
        initialCostSummary={costSummary}
        assetTitle={t("assetsTitle")}
        assetEmptyText={t("assetsEmpty")}
        assetSigningErrorLabel={t("assetSigningError")}
        statusLabels={getStatusLabels(tStatus)}
      />
    </>
  );
}

function ConsoleDetailSkeleton() {
  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardContent className="flex flex-col gap-3 p-5">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-16 w-full rounded-lg" />
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="h-[520px] p-5">
            <Skeleton className="h-full w-full rounded-lg" />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardContent className="flex flex-col gap-3 p-5">
          <Skeleton className="h-5 w-32" />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function BackButton({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <Button
      className="gap-1.5 text-zinc-400 hover:text-cyan-300"
      onClick={onBack}
      size="sm"
      type="button"
      variant="ghost"
    >
      <ArrowLeft className="size-4" />
      {label}
    </Button>
  );
}

function getStatusLabels(t: (key: string) => string) {
  return {
    READY: t("READY"),
    GENERATING: t("GENERATING"),
    FAILED: t("FAILED"),
    PENDING: t("PENDING")
  };
}
