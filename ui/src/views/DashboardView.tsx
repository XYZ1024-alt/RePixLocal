import { Activity, CheckCircle2, Film, PlayCircle } from "lucide-react";
import { ApiBudgetBars, PipelineDonutChart, ProcessingQueues, StackedBarChart } from "../components/Charts";
import { MetricCard } from "../components/MetricCard";
import type { DashboardSummary, Task } from "../types";

export function DashboardView(props: { summary: DashboardSummary | null; tasks: Task[] }) {
  const summary = props.summary;
  const successRate = formatSuccessRate(summary);

  return (
    <div className="view-grid">
      <section className="metric-grid">
        <MetricCard
          accent="cyan"
          delta="—"
          deltaPositive
          icon={<Activity size={16} />}
          label="Active Pipelines"
          value={String(summary?.running_tasks ?? 0)}
        />
        <MetricCard
          accent="purple"
          delta="—"
          deltaPositive
          icon={<PlayCircle size={16} />}
          label="Clone Tasks"
          value={String(summary?.total_tasks ?? 0)}
        />
        <MetricCard
          accent="blue"
          delta="—"
          deltaPositive
          icon={<Film size={16} />}
          label="Videos Today"
          value={String(summary?.videos_today ?? 0)}
        />
        <MetricCard
          accent="green"
          delta="—"
          deltaPositive
          icon={<CheckCircle2 size={16} />}
          label="Success Rate"
          value={successRate}
        />
      </section>
      <section className="dashboard-panels">
        <Panel title="Daily Video Output">
          <StackedBarChart />
        </Panel>
        <Panel title="Pipeline Status">
          <PipelineDonutChart summary={summary} />
        </Panel>
        <Panel title="Processing Queues">
          <ProcessingQueues tasks={props.tasks} />
        </Panel>
        <Panel title="API Budget Usage">
          <ApiBudgetBars />
        </Panel>
      </section>
    </div>
  );
}

function Panel(props: { children: React.ReactNode; title: string }) {
  return (
    <article className="panel-card">
      <h2>{props.title}</h2>
      {props.children}
    </article>
  );
}

function formatSuccessRate(summary: DashboardSummary | null) {
  if (!summary) return "—";
  const denominator = summary.completed_tasks + summary.failed_tasks;
  if (denominator === 0) return "—";
  return `${((summary.completed_tasks / denominator) * 100).toFixed(1)}%`;
}