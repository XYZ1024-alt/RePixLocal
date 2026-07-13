import { Plus, Sparkles } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";

type DashboardStateCopy = {
  title: string;
  description: string;
};

export function DashboardLoadingState({
  title,
  description,
  loadingLabel
}: DashboardStateCopy & { loadingLabel: string }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <div
        className="grid gap-4 px-4 pb-6 pt-3 sm:grid-cols-2 xl:grid-cols-4 lg:px-6"
        aria-label={loadingLabel}
      >
        {Array.from({ length: 8 }).map((_, index) => (
          <div
            key={index}
            className="h-28 rounded-lg border border-border bg-card animate-pulse"
          />
        ))}
      </div>
    </>
  );
}

export function DashboardEmptyState({
  title,
  description,
  emptyText,
  newTaskLabel,
  onNewTask
}: DashboardStateCopy & {
  emptyText: string;
  newTaskLabel: string;
  onNewTask: () => void;
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <div className="px-4 pb-6 pt-3 lg:px-6">
        <EmptyState
          icon={Sparkles}
          title={title}
          description={emptyText}
          action={
            <Button size="sm" onClick={onNewTask}>
              <Plus />
              {newTaskLabel}
            </Button>
          }
        />
      </div>
    </>
  );
}
