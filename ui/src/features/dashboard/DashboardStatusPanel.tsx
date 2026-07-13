import { DonutChart } from "@/components/charts";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardStatusSlice } from "./dashboard-model";

export function DashboardStatusPanel({
  title,
  emptyText,
  centerLabel,
  slices
}: {
  title: string;
  emptyText: string;
  centerLabel: string;
  slices: DashboardStatusSlice[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {slices.length > 0 ? (
          <DonutChart slices={slices} centerLabel={centerLabel} />
        ) : (
          <EmptyState description={emptyText} />
        )}
      </CardContent>
    </Card>
  );
}
