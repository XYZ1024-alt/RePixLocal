use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum PipelineEvent {
    Run {
        run_id: String,
        task_id: String,
        status: String,
    },
    Stage {
        run_id: String,
        stage: String,
        status: String,
    },
    Log {
        run_id: String,
        task_id: Option<String>,
        level: String,
        message: String,
    },
}

pub fn emit_pipeline_event(app: &AppHandle, event: PipelineEvent) {
    let _ = app.emit("pipeline-event", event);
}
