import { Activity, Archive, CheckCircle2, PlayCircle, XCircle } from "lucide-react";
import { DonutChart, MiniBars } from "../components/Charts";
import { EmptyState } from "../components/EmptyState";
import { MetricCard } from "../components/MetricCard";
import { StatusPill } from "../components/StatusPill";
import type { DashboardSummary, Task, ViewKey } from "../types";

export function DashboardView(props: {
  summary: DashboardSummary;
  tasks: Task[];
  onOpenTask: (taskId: string, view: ViewKey) => void;
  onStart: (taskId: string) => void;
}) {
  return (
    <div className="view-grid">
      <section className="metric-grid">
        <MetricCard accent="cyan" detail="本地任务总数" icon={<Activity size={16} />} label="Active Pipelines" value={props.summary.total_tasks} />
        <MetricCard accent="purple" detail="正在执行的任务" icon={<PlayCircle size={16} />} label="Running Tasks" value={props.summary.running_tasks} />
        <MetricCard accent="blue" detail="已入库资产数量" icon={<Archive size={16} />} label="Local Assets" value={props.summary.asset_count} />
        <MetricCard accent="green" detail="成功完成任务" icon={<CheckCircle2 size={16} />} label="Completed" value={props.summary.completed_tasks} />
      </section>
      <section className="dashboard-panels">
        <Panel title="Daily Task Output"><MiniBars tasks={props.tasks} /></Panel>
        <Panel title="Pipeline Status">
          <DonutChart
            completed={props.summary.completed_tasks}
            failed={props.summary.failed_tasks}
            running={props.summary.running_tasks}
            total={props.summary.total_tasks}
          />
        </Panel>
        <Panel title="Recent Tasks">
          <RecentTasks tasks={props.summary.latest_tasks} onOpenTask={props.onOpenTask} onStart={props.onStart} />
        </Panel>
        <Panel title="API Budget Usage">
          <EmptyState icon={<XCircle size={20} />} title="未接入用量统计" detail="Provider 用量接口尚未实现，不显示模拟额度。" />
        </Panel>
      </section>
    </div>
  );
}

function Panel(props: { children: React.ReactNode; title: string }) {
  return <article className="panel-card"><h2>{props.title}</h2>{props.children}</article>;
}

function RecentTasks(props: {
  tasks: Task[];
  onOpenTask: (taskId: string, view: ViewKey) => void;
  onStart: (taskId: string) => void;
}) {
  if (props.tasks.length === 0) {
    return <EmptyState title="暂无任务" detail="从 Task Wizard 创建第一个本地复刻任务。" />;
  }
  return <div className="task-list">{props.tasks.map((task) => <TaskRow key={task.id} task={task} {...props} />)}</div>;
}

function TaskRow(props: {
  task: Task;
  onOpenTask: (taskId: string, view: ViewKey) => void;
  onStart: (taskId: string) => void;
}) {
  return (
    <div className="task-row">
      <div><strong>{props.task.title}</strong><span>{props.task.source_path}</span></div>
      <StatusPill status={props.task.status} />
      <button onClick={() => props.onOpenTask(props.task.id, "console")}>Console</button>
      <button className="accent-button" onClick={() => props.onStart(props.task.id)}>Run</button>
    </div>
  );
}
