import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { getRun, getRunCosts, listAssets } from "@/api";
import { ConsoleLive, type LogSnapshot, type StageSnapshot } from "@/components/ConsoleLive";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
}) {
  const t = useTranslations("console");
  const tStages = useTranslations("stages");
  const tStatus = useTranslations("status");
  const [loaded, setLoaded] = useState<LoadedDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
            <CardContent className="py-8 text-sm text-muted-foreground">{t("empty")}</CardContent>
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
          <Card>
            <CardContent className="py-8 text-sm text-muted-foreground">{t("noRuns")}</CardContent>
          </Card>
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
          <Card>
            <CardContent className="py-8 text-sm text-muted-foreground">
              {error ?? t("empty")}
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  const { detail, costSummary, assets } = loaded;
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
        actions={<BackButton label={t("backToList")} onBack={props.onBack} />}
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

function BackButton({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <Button className="gap-1.5 text-muted-foreground" onClick={onBack} type="button" variant="ghost">
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