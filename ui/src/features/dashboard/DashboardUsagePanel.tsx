import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardUsageRow } from "./dashboard-model";
import { MIN_VISIBLE_METER_PERCENT } from "./dashboard-balance";
import { DashboardEmptyRow } from "./DashboardEmptyRow";

export function DashboardUsagePanel({
  title,
  emptyText,
  rows
}: {
  title: string;
  emptyText: string;
  rows: DashboardUsageRow[];
}) {
  const max = Math.max(1, ...rows.map((row) => row.quantity));
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {rows.length > 0 ? (
          rows.map((row) => <UsageMeter key={row.provider} row={row} max={max} />)
        ) : (
          <DashboardEmptyRow text={emptyText} />
        )}
      </CardContent>
    </Card>
  );
}

function UsageMeter({ row, max }: { row: DashboardUsageRow; max: number }) {
  const value = Math.max(
    (row.quantity / max) * 100,
    MIN_VISIBLE_METER_PERCENT
  );

  return (
    <div className="group flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-foreground">{row.provider}</span>
        <span className="text-muted-foreground">{row.meta}</span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-surface-inset ring-1 ring-inset ring-border">
        <div
          className="h-full origin-left rounded-full bg-brand transition-transform duration-panel group-hover:bg-brand/80"
          style={{ transform: `scaleX(${Math.min(value, 100) / 100})` }}
        />
      </div>
    </div>
  );
}
