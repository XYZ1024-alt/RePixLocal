import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslations } from "@/i18n/context";
import type { DashboardQueueRow } from "./dashboard-model";
import { DashboardEmptyRow } from "./DashboardEmptyRow";

const STATUS_VARIANT: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
  COMPLETED: "success",
  RUNNING: "warning",
  FAILED: "destructive",
  PENDING: "secondary",
  PAUSED: "secondary",
  CANCELLED: "secondary"
};

export function DashboardQueuePanel({
  title,
  emptyText,
  rows,
  onOpenRun
}: {
  title: string;
  emptyText: string;
  rows: DashboardQueueRow[];
  onOpenRun?: (runId: string) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length > 0 ? (
          <QueueTable rows={rows} onOpenRun={onOpenRun} />
        ) : (
          <DashboardEmptyRow text={emptyText} />
        )}
      </CardContent>
    </Card>
  );
}

function QueueTable({
  rows,
  onOpenRun
}: {
  rows: DashboardQueueRow[];
  onOpenRun?: (runId: string) => void;
}) {
  const t = useTranslations("dashboard");
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <caption className="sr-only">{t("queueTitle")}</caption>
        <thead className="border-b border-border text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-5 py-2 font-medium">{t("task")}</th>
            <th className="px-4 py-2 font-medium">{t("stage")}</th>
            <th className="px-4 py-2 font-medium">{t("progress")}</th>
            <th className="px-5 py-2 text-right font-medium">{t("state")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <QueueTableRow key={row.id} row={row} onOpenRun={onOpenRun} progressLabel={t("progress")} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QueueTableRow({
  row,
  onOpenRun,
  progressLabel
}: {
  row: DashboardQueueRow;
  onOpenRun?: (runId: string) => void;
  progressLabel: string;
}) {
  return (
    <tr
      className="group cursor-pointer text-foreground transition-colors duration-control hover:bg-accent/50"
      onClick={() => onOpenRun?.(row.id)}
    >
      <td className="px-5 py-3.5 font-medium text-foreground">
        <button
          type="button"
          className="rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(event) => {
            event.stopPropagation();
            onOpenRun?.(row.id);
          }}
        >
          {row.title}
        </button>
      </td>
      <td className="px-4 py-3.5 text-muted-foreground">{row.stage}</td>
      <td className="w-44 px-4 py-3.5">
        <ProgressBar label={progressLabel} value={row.progress} />
      </td>
      <td className="px-5 py-3.5 text-right">
        <Badge
          variant={STATUS_VARIANT[row.status] ?? "secondary"}
          className={row.status === "RUNNING" ? "border-brand/30 bg-brand/10 text-brand" : undefined}
        >
          {row.statusLabel}
        </Badge>
      </td>
    </tr>
  );
}

function ProgressBar({ label, value }: { label: string; value: number }) {
  const width = Math.min(value, 100);
  return (
    <div className="relative h-2 overflow-hidden rounded-full bg-surface-inset ring-1 ring-inset ring-border">
      <div
        className="motion-progress h-full origin-left rounded-full bg-brand transition-transform duration-panel"
        style={{ transform: `scaleX(${width / 100})` }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={width}
        aria-label={`${label}: ${width}%`}
      />
    </div>
  );
}
