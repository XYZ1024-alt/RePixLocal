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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
#[serde(rename_all = "snake_case")]
pub enum AssetStatus {
    Pending,
    Generating,
    Ready,
    Failed,
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
    pub created_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineStage {
    pub id: String,
    pub run_id: String,
    pub stage_type: StageType,
    pub status: StageStatus,
    pub error: Option<String>,
    pub order_index: Option<i32>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scene {
    pub id: String,
    pub task_id: String,
    pub run_id: Option<String>,
    pub scene_index: i32,
    pub script_text: String,
    pub visual_prompt: Option<String>,
    pub motion_prompt: Option<String>,
    pub metadata_json: Option<Value>,
    pub created_at: DateTime<Utc>,
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
    pub status: Option<AssetStatus>,
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
pub struct TranscriptSegment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderSettings {
    pub api_key: String,
    pub base_url: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewrittenScene {
    pub index: i32,
    pub script_text: String,
    pub visual_prompt: Option<String>,
    pub motion_prompt: Option<String>,
    pub keyframe_path: Option<String>,
    pub start_ms: Option<i64>,
    pub end_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptResult {
    pub language: String,
    pub segments: Vec<TranscriptSegment>,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCheck {
    pub name: String,
    pub found: bool,
    pub path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderModelOption {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderCredentialConfig {
    pub base_url: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderCredentialView {
    pub provider: String,
    pub masked_key: String,
    pub config: Option<ProviderCredentialConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunListItem {
    pub id: String,
    pub task_id: String,
    pub title: String,
    pub status: String,
    pub current_stage: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunDetailLog {
    pub ts: String,
    pub level: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunDetailStage {
    pub stage_type: String,
    pub status: String,
    pub error: Option<String>,
    pub order_index: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunDetail {
    pub id: String,
    pub task_id: String,
    pub task_title: String,
    pub status: String,
    pub current_stage: Option<String>,
    pub error: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub created_at: Option<String>,
    pub stages: Vec<RunDetailStage>,
    pub logs: Vec<RunDetailLog>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardStats {
    pub total_tasks: i64,
    pub running: i64,
    pub completed: i64,
    pub success_rate: i64,
    pub assets_ready: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrendPoint {
    pub date: String,
    pub value: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueItem {
    pub id: String,
    pub title: String,
    pub status: String,
    pub current_stage: Option<String>,
    pub progress: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageItem {
    pub provider: String,
    pub calls: i64,
    pub quantity: f64,
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardData {
    pub stats: DashboardStats,
    pub status_count: std::collections::HashMap<String, i64>,
    pub trend: Vec<TrendPoint>,
    pub queue: Vec<QueueItem>,
    pub usage: Vec<UsageItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmitTaskResponse {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PickedVideoFile {
    pub path: String,
    pub name: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderCostSummary {
    pub provider: String,
    pub calls: i64,
    pub failed_calls: i64,
    pub quantity: f64,
    pub unit: String,
    pub cost_usd: f64,
    pub unknown_cost_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostSummary {
    pub total_cost_usd: f64,
    pub incomplete: bool,
    pub providers: Vec<ProviderCostSummary>,
}
