import type { Task } from "../types";

export function MiniBars(props: { tasks: Task[] }) {
  const buckets = lastSevenDays(props.tasks);
  const max = Math.max(...buckets.map((bucket) => bucket.count), 1);
  return (
    <div className="bar-chart">
      {buckets.map((bucket) => (
        <div className="bar-item" key={bucket.label}>
          <span style={{ height: `${Math.max(8, (bucket.count / max) * 100)}%` }} />
          <small>{bucket.label}</small>
        </div>
      ))}
    </div>
  );
}

export function DonutChart(props: { running: number; completed: number; failed: number; total: number }) {
  const percent = props.total > 0 ? Math.round((props.completed / props.total) * 100) : 0;
  return (
    <div className="donut-wrap">
      <div className="donut" style={{ "--done": `${percent}%` } as React.CSSProperties}>
        <strong>{props.total}</strong>
        <span>Total</span>
      </div>
      <div className="legend-list">
        <Legend label="Running" value={props.running} />
        <Legend label="Completed" value={props.completed} />
        <Legend label="Failed" value={props.failed} />
      </div>
    </div>
  );
}

function Legend(props: { label: string; value: number }) {
  return <div className="legend-row"><span>{props.label}</span><strong>{props.value}</strong></div>;
}

function lastSevenDays(tasks: Task[]) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    return { label: `${date.getMonth() + 1}/${date.getDate()}`, count: countByDay(tasks, date) };
  });
}

function countByDay(tasks: Task[], date: Date) {
  return tasks.filter((task) => new Date(task.created_at).toDateString() === date.toDateString()).length;
}
