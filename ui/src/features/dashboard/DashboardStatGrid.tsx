import { Card, CardContent } from "@/components/ui/card";
import type { TaskFilter } from "@/types";
import type { DashboardStatCard } from "./dashboard-model";

export function DashboardStatGrid({
  cards,
  onOpen
}: {
  cards: DashboardStatCard[];
  onOpen?: (filter: TaskFilter) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <MetricCard key={card.label} card={card} onOpen={onOpen} />
      ))}
    </div>
  );
}

function MetricCard({
  card,
  onOpen
}: {
  card: DashboardStatCard;
  onOpen?: (filter: TaskFilter) => void;
}) {
  const Icon = card.icon;

  return (
    <button
      type="button"
      className="rounded-lg text-left transition-transform [transition-duration:var(--motion-press)] ease-fluid-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-safe:active:scale-[0.99]"
      onClick={() => onOpen?.(card.filter)}
    >
      <Card interactive className="h-full overflow-hidden">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-3">
              <span className="text-xs font-semibold text-muted-foreground">{card.label}</span>
              <span className="text-3xl font-bold tabular-nums">{card.value}</span>
            </div>
            <span className="rounded-md bg-info/10 p-2.5 ring-1 ring-inset ring-info/20">
              <Icon className="size-5 text-info" />
            </span>
          </div>
          <p className="mt-4 text-xs font-medium text-muted-foreground">{card.note}</p>
        </CardContent>
      </Card>
    </button>
  );
}
