import { BarChart } from "@/components/charts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardTrendPoint } from "./dashboard-model";

export function DashboardTrendPanel({
  title,
  rangeLabel,
  data
}: {
  title: string;
  rangeLabel: string;
  data: DashboardTrendPoint[];
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between pb-3">
        <CardTitle>{title}</CardTitle>
        <Badge variant="outline">{rangeLabel}</Badge>
      </CardHeader>
      <CardContent>
        <BarChart data={data} />
      </CardContent>
    </Card>
  );
}
