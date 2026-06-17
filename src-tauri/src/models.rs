use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Draft,
    Running,
    Completed,
    Failed,
    Canceled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Running,
    Completed,
    Failed,
    Canceled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StageStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Canceled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StageType {
    TranscriptExtraction,
    ScriptRewrite,
    StoryboardGeneration,
    SegmentGeneration,
    FinalRender,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssetType {
    SourceVideo,
    Audio,
    Keyframe,
    GeneratedFrame,
    VideoSegment,
    Subtitle,
    FinalVideo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub source_path: String,
    pub status: TaskStatus,
    pub config_json: Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineRun {
    pub id: String,
    pub task_id: String,
    pub status: RunStatus,
    pub current_stage: Option<StageType>,
    pub error: Option<String>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineStage {
    pub id: String,
    pub run_id: String,
    pub stage_type: StageType,
    pub status: StageStatus,
    pub error: Option<String>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Asset {
    pub id: String,
    pub task_id: String,
    pub run_id: Option<String>,
    pub asset_type: AssetType,
    pub path: String,
    pub mime_type: Option<String>,
    pub scene_index: Option<i32>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppLog {
    pub id: String,
    pub task_id: Option<String>,
    pub run_id: Option<String>,
    pub level: String,
    pub message: String,
    pub context_json: Option<Value>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardSummary {
    pub total_tasks: i64,
    pub running_tasks: i64,
    pub completed_tasks: i64,
    pub failed_tasks: i64,
    pub canceled_tasks: i64,
    pub draft_tasks: i64,
    pub videos_today: i64,
    pub asset_count: i64,
    pub latest_tasks: Vec<Task>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTaskInput {
    pub title: String,
    pub source_path: String,
    pub config_json: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderCredentialInput {
    pub provider: String,
    pub label: String,
    pub api_key: String,
    pub base_url: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCheck {
    pub name: String,
    pub found: bool,
    pub path: Option<String>,
    pub error: Option<String>,
}
