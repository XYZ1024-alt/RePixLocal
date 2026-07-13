import { Play, RotateCcw, Square } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/ui/status-badge";
import { useTranslations } from "@/i18n/context";
import type { RunDetail, Task } from "@/types";
import {
  getDetailProgress,
  taskStatusTone,
  type TaskDetailActions
} from "./task-detail-model";

export function TaskDetailHero({
  task,
  detail,
  busy,
  actions
}: {
  task: Task;
  detail: RunDetail | null;
  busy: boolean;
  actions: TaskDetailActions;
}) {
  const status = detail?.status.toUpperCase() ?? task.status.toUpperCase();
  const canCancel = status === "RUNNING" || status === "PENDING";
  const canResume = status === "FAILED" || status === "CANCELLED" || status === "CANCELED";
  return (
    <Card className="bg-card/95 backdrop-blur-xl">
      <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <HeroSummary detail={detail} status={status} />
        <HeroProgress progress={getDetailProgress(detail)} />
        <HeroActions
          busy={busy}
          canCancel={canCancel}
          canResume={canResume}
          isDraft={!detail}
          actions={actions}
        />
      </CardContent>
    </Card>
  );
}

function HeroSummary({ detail, status }: { detail: RunDetail | null; status: string }) {
  const t = useTranslations("tasks");
  return (
    <div className="flex min-w-0 items-center gap-4">
      <StatusBadge status={taskStatusTone(status)}>
        {t(`statuses.${status}`)}
      </StatusBadge>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">
          {detail?.current_stage ? t(`stages.${detail.current_stage}`) : t("notStarted")}
        </p>
        <p className="text-xs text-muted-foreground">{detail?.id ?? t("noRunsYet")}</p>
      </div>
    </div>
  );
}

function HeroProgress({ progress }: { progress: number }) {
  const t = useTranslations("tasks");
  return (
    <div className="flex min-w-[160px] flex-1 items-center gap-3 sm:max-w-xs">
      <Progress label={t("progressLabel", { value: progress })} value={progress} />
      <span className="text-xs tabular-nums text-muted-foreground">{progress}%</span>
    </div>
  );
}

function HeroActions({
  busy,
  canCancel,
  canResume,
  isDraft,
  actions
}: {
  busy: boolean;
  canCancel: boolean;
  canResume: boolean;
  isDraft: boolean;
  actions: TaskDetailActions;
}) {
  const t = useTranslations("tasks");
  return (
    <div className="flex shrink-0 items-center gap-2">
      {canCancel ? <CancelButton busy={busy} onConfirm={actions.cancel} /> : null}
      {canResume ? (
        <Button
          disabled={busy}
          onClick={() => void actions.resume()}
          size="sm"
          type="button"
        >
          <RotateCcw />
          {t("resume")}
        </Button>
      ) : null}
      {isDraft ? (
        <Button
          disabled={busy}
          onClick={() => void actions.start()}
          size="sm"
          type="button"
        >
          <Play />
          {t("start")}
        </Button>
      ) : null}
    </div>
  );
}

function CancelButton({
  busy,
  onConfirm
}: {
  busy: boolean;
  onConfirm: () => Promise<void>;
}) {
  const t = useTranslations("tasks");
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button disabled={busy} size="sm" type="button" variant="outline">
          <Square />
          {t("cancel")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("cancelDialog.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("cancelDialog.description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancelDialog.keepRunning")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={() => void onConfirm()}
          >
            {t("cancelDialog.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
