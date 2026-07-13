import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useLocale, useTranslations } from "@/i18n/context";
import type { RunDetail, Task } from "@/types";
import type { TaskDetailActions } from "./task-detail-model";
import { TaskDetailHero } from "./TaskDetailHero";

export function TaskDetailStatusRegion({
  task,
  detail,
  actions,
  busy,
  actionError,
  refreshError,
  lastUpdated,
  onRetry
}: {
  task: Task;
  detail: RunDetail | null;
  actions: TaskDetailActions;
  busy: boolean;
  actionError: string | null;
  refreshError: string | null;
  lastUpdated: Date | null;
  onRetry: () => Promise<void>;
}) {
  const t = useTranslations("tasks");
  return (
    <div className="sticky top-0 z-20 px-4 pb-2 pt-3 lg:px-6">
      <TaskDetailHero task={task} detail={detail} busy={busy} actions={actions} />
      {actionError ? (
        <InlineAlert
          className="mt-3"
          details={actionError}
          detailsLabel={t("errorDetails")}
          title={t("actionFailed")}
          variant="error"
        />
      ) : null}
      {refreshError ? (
        <RefreshError error={refreshError} lastUpdated={lastUpdated} onRetry={onRetry} />
      ) : null}
    </div>
  );
}

function RefreshError({
  error,
  lastUpdated,
  onRetry
}: {
  error: string;
  lastUpdated: Date | null;
  onRetry: () => Promise<void>;
}) {
  const t = useTranslations("tasks");
  const { locale } = useLocale();
  return (
    <InlineAlert
      className="mt-3"
      details={error}
      detailsLabel={t("errorDetails")}
      title={t("refreshFailed")}
      variant="warning"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          {t("lastUpdated", {
            time: lastUpdated?.toLocaleTimeString(locale) ?? t("never")
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
    </InlineAlert>
  );
}
