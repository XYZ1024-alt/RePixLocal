import { PageHeader } from "@/components/PageHeader";
import { DashboardBalancePanel } from "@/features/dashboard/DashboardBalancePanel";
import { DashboardQueuePanel } from "@/features/dashboard/DashboardQueuePanel";
import { DashboardStatGrid } from "@/features/dashboard/DashboardStatGrid";
import { DashboardStatusPanel } from "@/features/dashboard/DashboardStatusPanel";
import {
  DashboardEmptyState,
  DashboardLoadingState
} from "@/features/dashboard/DashboardStates";
import { DashboardTrendPanel } from "@/features/dashboard/DashboardTrendPanel";
import { DashboardUsagePanel } from "@/features/dashboard/DashboardUsagePanel";
import { useDashboard } from "@/features/dashboard/use-dashboard";
import type { DashboardData, TaskFilter } from "@/types";

export function DashboardView(props: {
  data: DashboardData | null;
  loaded?: boolean;
  onNewTask: () => void;
  onOpenRun?: (runId: string) => void;
  onOpenTasks?: (filter: TaskFilter) => void;
}) {
  const { balanceState, model, reloadBalances, t } = useDashboard(props.data);
  const stateCopy = { title: t("title"), description: t("description") };

  if (!props.data && !props.loaded) {
    return (
      <DashboardLoadingState
        {...stateCopy}
        loadingLabel={t("loading")}
      />
    );
  }

  if (!props.data || !model) {
    return (
      <DashboardEmptyState
        {...stateCopy}
        emptyText={t("noTasks")}
        newTaskLabel={t("newTask")}
        onNewTask={props.onNewTask}
      />
    );
  }

  return (
    <>
      <PageHeader {...stateCopy} />
      <div className="flex flex-col gap-5 px-4 pb-6 pt-3 lg:px-6">
        <DashboardStatGrid cards={model.cards} onOpen={props.onOpenTasks} />
        <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
          <DashboardTrendPanel
            title={t("trendTitle")}
            rangeLabel={t("sevenDays")}
            data={model.trend}
          />
          <DashboardStatusPanel
            title={t("statusTitle")}
            emptyText={t("noTasks")}
            centerLabel={t("centerLabel")}
            slices={model.statusSlices}
          />
        </div>
        <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
          <DashboardQueuePanel
            title={t("queueTitle")}
            emptyText={t("noRuns")}
            rows={model.queueRows}
            onOpenRun={props.onOpenRun}
          />
          <div className="grid gap-5">
            <DashboardBalancePanel state={balanceState} onRefresh={reloadBalances} />
            <DashboardUsagePanel
              title={t("apiUsageTitle")}
              emptyText={t("noUsage")}
              rows={model.usageRows}
            />
          </div>
        </div>
      </div>
    </>
  );
}
