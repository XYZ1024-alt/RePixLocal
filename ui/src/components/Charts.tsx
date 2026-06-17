import { EmptyState } from "./EmptyState";
import type { DashboardSummary, Task } from "../types";

export function StackedBarChart() {
  return <EmptyState message="No daily output data yet" />;
}

export function PipelineDonutChart(props: { summary: DashboardSummary | null }) {
  if (!props.summary) {
    return <EmptyState message="No pipeline data yet" />;
  }

  const { running_tasks, draft_tasks, failed_tasks, completed_tasks } = props.summary;
  const total = running_tasks + draft_tasks + failed_tasks + completed_tasks;

  if (total === 0) {
    return <EmptyState message="No pipeline data yet" />;
  }

  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const r1 = pct(running_tasks);
  const r2 = r1 + pct(draft_tasks);
  const r3 = r2 + pct(failed_tasks);

  const gradient = `conic-gradient(
    var(--blue) 0 ${r1}%,
    var(--cyan) ${r1}% ${r2}%,
    var(--red) ${r2}% ${r3}%,
    var(--green) ${r3}% 100%
  )`;

  return (
    <div className="donut-wrap">
      <div className="donut" style={{ background: gradient }}>
        <strong>{total}</strong>
        <span>Total</span>
      </div>
      <div className="legend-list">
        <LegendRow color="var(--blue)" label="Running" pct={Math.round(pct(running_tasks))} value={running_tasks} />
        <LegendRow color="var(--cyan)" label="Queued" pct={Math.round(pct(draft_tasks))} value={draft_tasks} />
        <LegendRow color="var(--red)" label="Failed" pct={Math.round(pct(failed_tasks))} value={failed_tasks} />
        <LegendRow color="var(--green)" label="Completed" pct={Math.round(pct(completed_tasks))} value={completed_tasks} />
      </div>
    </div>
  );
}

export function ProcessingQueues(props: { tasks: Task[] }) {
  const running = props.tasks.filter((task) => task.status === "running");

  if (running.length === 0) {
    return <EmptyState message="No active processing queues" />;
  }

  return (
    <div className="queue-list">
      {running.map((task) => (
        <div className="queue-row" key={task.id}>
          <div className="queue-row-head">
            <span>{task.title}</span>
            <strong>—</strong>
          </div>
          <div className="progress-track">
            <span className="progress-fill" style={{ width: "0%" }} />
          </div>
          <small>Status: {task.status}</small>
        </div>
      ))}
    </div>
  );
}

export function ApiBudgetBars() {
  return <EmptyState message="API usage tracking not configured" />;
}

function LegendRow(props: { color: string; label: string; value: number; pct: number }) {
  return (
    <div className="legend-row detailed">
      <span className="legend-dot-item">
        <span className="legend-dot" style={{ background: props.color }} />
        {props.label}
      </span>
      <span>
        <strong>{props.value}</strong> ({props.pct}%)
      </span>
    </div>
  );
}