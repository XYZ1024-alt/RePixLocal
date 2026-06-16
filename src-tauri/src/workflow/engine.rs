use std::sync::Arc;

use crate::db::Repository;
use crate::errors::{AppError, AppResult};
use crate::media::ffmpeg::FfmpegRunner;
use crate::models::{PipelineRun, StageType, TaskStatus};
use crate::storage::local_assets::AssetManager;

#[derive(Debug, Clone)]
pub struct WorkflowEngine {
    repo: Arc<Repository>,
    assets: Arc<AssetManager>,
    ffmpeg: Arc<FfmpegRunner>,
}

impl WorkflowEngine {
    pub fn new(
        repo: Arc<Repository>,
        assets: Arc<AssetManager>,
        ffmpeg: Arc<FfmpegRunner>,
    ) -> Self {
        Self {
            repo,
            assets,
            ffmpeg,
        }
    }

    pub async fn start(&self, task_id: &str) -> AppResult<PipelineRun> {
        let task = self.require_task(task_id).await?;
        self.repo
            .update_task_status(task_id, TaskStatus::Running)
            .await?;
        self.repo
            .insert_log(Some(task_id), "info", "workflow started")
            .await?;
        let source_asset = self
            .assets
            .import_source_video(task_id, &task.source_path)
            .await?;
        self.repo.insert_asset(&source_asset).await?;
        let run = self.repo.create_run(task_id).await?;
        self.run_first_stage(task_id, &run).await?;
        Ok(run)
    }

    pub async fn cancel(&self, task_id: &str) -> AppResult<()> {
        self.repo
            .update_task_status(task_id, TaskStatus::Canceled)
            .await?;
        self.repo
            .insert_log(Some(task_id), "warn", "workflow canceled by user")
            .await?;
        Ok(())
    }

    async fn require_task(&self, task_id: &str) -> AppResult<crate::models::Task> {
        self.repo
            .get_task(task_id)
            .await?
            .ok_or_else(|| AppError::Workflow(format!("task not found: {task_id}")))
    }

    async fn run_first_stage(&self, task_id: &str, run: &PipelineRun) -> AppResult<()> {
        self.repo
            .start_stage(&run.id, StageType::TranscriptExtraction)
            .await?;
        let error = self.validate_media_tools();
        self.repo
            .fail_run(&run.id, StageType::TranscriptExtraction, &error)
            .await?;
        self.repo
            .update_task_status(task_id, TaskStatus::Failed)
            .await?;
        self.repo.insert_log(Some(task_id), "error", &error).await?;
        Err(AppError::Workflow(error))
    }

    fn validate_media_tools(&self) -> String {
        let missing: Vec<String> = self
            .ffmpeg
            .check_tools()
            .into_iter()
            .filter(|tool| !tool.found)
            .map(|tool| tool.name)
            .collect();
        if missing.is_empty() {
            return "transcript extraction is not implemented yet".to_string();
        }
        format!("missing external tools: {}", missing.join(", "))
    }
}
