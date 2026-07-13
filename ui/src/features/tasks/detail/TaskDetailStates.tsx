import { ArrowLeft, Inbox, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslations } from "@/i18n/context";

export function TaskDetailLoading({ onBack }: { onBack: () => void }) {
  const t = useTranslations("tasks");
  return (
    <>
      <PageHeader
        title={t("detailTitle")}
        actions={<TaskDetailBackButton label={t("backToTasks")} onBack={onBack} />}
      />
      <div className="flex flex-col gap-4 px-4 py-3 lg:px-6">
        <Skeleton className="h-24 w-full rounded-md" />
        <Skeleton className="h-10 w-96 max-w-full rounded-md" />
        <Skeleton className="h-80 w-full rounded-md" />
      </div>
    </>
  );
}

export function TaskDetailLoadError({
  error,
  onBack,
  onRetry
}: {
  error: string | null;
  onBack: () => void;
  onRetry: () => Promise<void>;
}) {
  const t = useTranslations("tasks");
  return (
    <>
      <PageHeader
        title={t("detailTitle")}
        actions={<TaskDetailBackButton label={t("backToTasks")} onBack={onBack} />}
      />
      <div className="px-4 py-3 lg:px-6">
        <Card>
          <EmptyState
            icon={Inbox}
            title={t("loadError")}
            description={error ?? t("taskUnavailable")}
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
      </div>
    </>
  );
}

export function TaskDetailBackButton({
  label,
  onBack
}: {
  label: string;
  onBack: () => void;
}) {
  return (
    <Button onClick={onBack} size="sm" type="button" variant="ghost">
      <ArrowLeft />
      {label}
    </Button>
  );
}
