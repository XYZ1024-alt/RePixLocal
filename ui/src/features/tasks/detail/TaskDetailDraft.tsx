import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useTranslations } from "@/i18n/context";
import type { LibraryAsset } from "@/lib/library";
import type { Task } from "@/types";

export function TaskDetailDraft({
  task,
  assets,
  busy,
  onStart
}: {
  task: Task;
  assets: LibraryAsset[];
  busy: boolean;
  onStart: () => Promise<void>;
}) {
  return (
    <main className="px-4 pb-6 pt-3 lg:px-6">
      <Card>
        <CardContent className="grid gap-5 p-5 md:grid-cols-2">
          <DraftMetadata task={task} assetCount={assets.length} />
          <DraftStart busy={busy} onStart={onStart} />
        </CardContent>
      </Card>
    </main>
  );
}

function DraftMetadata({ task, assetCount }: { task: Task; assetCount: number }) {
  const t = useTranslations("tasks");
  return (
    <div>
      <h2 className="text-sm font-semibold text-foreground">{t("draft.title")}</h2>
      <dl className="mt-4 grid gap-3 text-sm">
        <SummaryField label={t("draft.source")} value={task.source_path} />
        <SummaryField
          label={t("draft.type")}
          value={task.task_type ? t(`taskTypes.${task.task_type}`) : t("unknown")}
        />
        <SummaryField label={t("draft.assets")} value={String(assetCount)} />
      </dl>
    </div>
  );
}

function DraftStart({ busy, onStart }: { busy: boolean; onStart: () => Promise<void> }) {
  const t = useTranslations("tasks");
  return (
    <div className="flex flex-col items-start justify-center rounded-md border border-dashed bg-muted/20 p-5">
      <p className="text-sm text-muted-foreground">{t("draft.description")}</p>
      <Button
        className="mt-4"
        disabled={busy}
        onClick={() => void onStart()}
        type="button"
      >
        <Play />
        {t("start")}
      </Button>
    </div>
  );
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-all text-foreground">{value}</dd>
    </div>
  );
}
