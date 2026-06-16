import { CheckCircle2, Circle, Play, Square } from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { StatusPill } from "../components/StatusPill";
import type { AppLog, PipelineRun, Task } from "../types";

const stages = ["transcript_extraction", "script_rewrite", "storyboard_generation", "segment_generation", "final_render"];

export function PipelineConsoleView(props: {
  logs: AppLog[];
  run: PipelineRun | null;
  task?: Task;
  onCancel: (taskId: string) => void;
}) {
  if (!props.task) {
    return <EmptyState title="未选择任务" detail="从 Dashboard 选择一个任务查看流水线状态。" />;
  }
  return (
    <div className="console-layout">
      <section className="panel-card timeline-panel">
        <ConsoleHeader task={props.task} onCancel={props.onCancel} />
        {stages.map((stage) => <StageLine active={props.run?.current_stage === stage} key={stage} stage={stage} />)}
      </section>
      <section className="console-main">
        <VideoPreview title="Original Video" value={props.task.source_path} />
        <VideoPreview title="Recreated Video" value="最终视频尚未生成" />
        <LogPanel logs={props.logs} run={props.run} />
      </section>
    </div>
  );
}

function ConsoleHeader(props: { task: Task; onCancel: (taskId: string) => void }) {
  return (
    <div className="console-header">
      <div><p className="eyebrow">Pipeline</p><h2>{props.task.title}</h2></div>
      <StatusPill status={props.task.status} />
      <button onClick={() => props.onCancel(props.task.id)}><Square size={14} /> Cancel</button>
    </div>
  );
}

function StageLine(props: { active: boolean; stage: string }) {
  return (
    <div className={props.active ? "stage-line active" : "stage-line"}>
      {props.active ? <CheckCircle2 size={18} /> : <Circle size={18} />}
      <div><strong>{stageLabel(props.stage)}</strong><span>{props.active ? "当前阶段" : "等待真实执行状态"}</span></div>
    </div>
  );
}

function VideoPreview(props: { title: string; value: string }) {
  return (
    <article className="panel-card video-panel">
      <h2>{props.title}</h2>
      <div className="video-surface"><Play size={28} /><span>{props.value}</span></div>
    </article>
  );
}

function LogPanel(props: { logs: AppLog[]; run: PipelineRun | null }) {
  return (
    <article className="panel-card log-panel">
      <h2>Real-time Logs</h2>
      {props.run?.error && <div className="log-line error">[{props.run.status}] {props.run.error}</div>}
      {props.logs.length === 0 && <EmptyState title="暂无日志" detail="任务运行后会显示数据库中的真实日志。" />}
      {props.logs.map((log) => <div className={`log-line ${log.level}`} key={log.id}>[{formatTime(log.created_at)}] {log.message}</div>)}
    </article>
  );
}

function stageLabel(stage: string) {
  return stage.replace(/_/g, " ");
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString();
}
