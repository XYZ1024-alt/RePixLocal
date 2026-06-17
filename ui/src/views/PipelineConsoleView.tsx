import { CheckCircle2, Circle, Loader2, Pause, Play, XCircle } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { TaskPicker } from "../components/TaskPicker";
import { SCENIC_GRADIENT } from "../constants";
import type { AppLog, PipelineRun, PipelineStage, Task } from "../types";

type ConsoleTab = "logs" | "metrics";
type StageUiStatus = "completed" | "in_progress" | "pending" | "failed";

export function PipelineConsoleView(props: {
  logs: AppLog[];
  run: PipelineRun | null;
  stages: PipelineStage[];
  task?: Task;
  tasks: Task[];
  selectedTaskId: string;
  onSelectTask: (taskId: string) => void;
  onCancel: (taskId: string) => void;
}) {
  const [tab, setTab] = useState<ConsoleTab>("logs");
  const pipelineId = props.run?.id ?? "—";
  const status = props.run?.status ?? props.task?.status ?? "—";
  const startedAt = props.run?.started_at ? formatDateTime(props.run.started_at) : "—";

  const displayLogs = props.logs.map((log) => `[${formatTime(log.created_at)}] ${log.message}`);

  return (
    <div className="console-layout-v2">
      <section className="panel-card console-steps-panel">
        <TaskPicker
          selectedTaskId={props.selectedTaskId}
          tasks={props.tasks}
          onSelectTask={props.onSelectTask}
        />
        <ConsoleHeader
          pipelineId={pipelineId}
          startedAt={startedAt}
          status={status}
          onCancel={() => props.task && props.onCancel(props.task.id)}
        />
        <div className="console-tabs">
          <button className={tab === "logs" ? "tab-btn active" : "tab-btn"} onClick={() => setTab("logs")} type="button">
            Live Logs
          </button>
          <button className={tab === "metrics" ? "tab-btn active" : "tab-btn"} onClick={() => setTab("metrics")} type="button">
            Metrics
          </button>
        </div>
        {props.stages.length === 0 ? (
          <EmptyState message="No pipeline stages yet" />
        ) : (
          props.stages.map((stage, index) => (
            <StageLine
              index={index + 1}
              key={stage.id}
              label={stageLabel(stage.stage_type)}
              status={mapStageStatus(stage.status)}
            />
          ))
        )}
      </section>

      <section className="console-center">
        <VideoPlayer label="Original Video" subtitle="—" />
        <VideoPlayer label="Recreated Video (Preview)" subtitle="—" />
      </section>

      <aside className="panel-card console-log-rail">
        {tab === "logs" ? (
          <>
            <h2>Real-time Logs</h2>
            <div className="log-scroll">
              {displayLogs.length === 0 ? (
                <EmptyState message="No logs yet" />
              ) : (
                displayLogs.map((line, i) => (
                  <div className="log-line" key={i}>
                    {line}
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <>
            <h2>Metrics</h2>
            <EmptyState message="Runtime metrics not available" />
          </>
        )}
      </aside>
    </div>
  );
}

function ConsoleHeader(props: {
  pipelineId: string;
  status: string;
  startedAt: string;
  onCancel: () => void;
}) {
  return (
    <div className="console-header-v2">
      <div>
        <p className="eyebrow">Pipeline</p>
        <h2>#{props.pipelineId}</h2>
        <small>Started {props.startedAt}</small>
      </div>
      <span className={`status-pill ${props.status}`}>{props.status}</span>
      <button onClick={props.onCancel} type="button">
        Cancel
      </button>
    </div>
  );
}

function StageLine(props: { index: number; label: string; status: StageUiStatus }) {
  const Icon =
    props.status === "completed"
      ? CheckCircle2
      : props.status === "in_progress"
        ? Loader2
        : props.status === "failed"
          ? XCircle
          : Circle;
  const statusLabel =
    props.status === "completed"
      ? "Completed"
      : props.status === "in_progress"
        ? "In Progress"
        : props.status === "failed"
          ? "Failed"
          : "Pending";

  return (
    <div className={`stage-line-v2 ${props.status}`}>
      <span className="stage-num">{props.index}</span>
      <Icon className={props.status === "in_progress" ? "spin" : ""} size={18} />
      <div>
        <strong>{props.label}</strong>
        <span>{statusLabel}</span>
      </div>
    </div>
  );
}

function VideoPlayer(props: { label: string; subtitle: string }) {
  return (
    <article className="panel-card video-player-card">
      <h2>{props.label}</h2>
      <div className="video-player" style={{ background: SCENIC_GRADIENT }}>
        <button className="play-btn" type="button">
          <Play size={22} fill="currentColor" />
        </button>
      </div>
      <div className="player-controls">
        <Pause size={14} />
        <div className="player-track">
          <span className="player-progress" style={{ width: "0%" }} />
        </div>
        <small>{props.subtitle}</small>
      </div>
    </article>
  );
}

function stageLabel(stageType: string) {
  const labels: Record<string, string> = {
    transcript_extraction: "Transcript Extraction",
    script_rewrite: "Script Rewrite",
    storyboard_generation: "Storyboard Generation",
    segment_generation: "Segment Generation",
    final_render: "Final Render"
  };
  return labels[stageType] ?? stageType;
}

function mapStageStatus(status: string): StageUiStatus {
  if (status === "completed") return "completed";
  if (status === "running") return "in_progress";
  if (status === "failed" || status === "canceled") return "failed";
  return "pending";
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString();
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}