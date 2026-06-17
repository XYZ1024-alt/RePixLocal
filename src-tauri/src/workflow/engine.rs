use std::sync::Arc;

use tauri::AppHandle;
use tokio::sync::RwLock;

use crate::config::AppConfig;
use crate::db::Repository;
use crate::errors::AppResult;
use crate::media::ffmpeg::FfmpegRunner;
use crate::models::{PipelineRun, TaskStatus};
use crate::storage::local_assets::AssetManager;
use crate::workflow::events::{emit_pipeline_event, PipelineEvent};
use crate::workflow::runner::PipelineRunner;

#[derive(Debug, Clone)]
pub struct WorkflowEngine {
    repo: Arc<Repository>,
    assets: Arc<AssetManager>,
    ffmpeg: Arc<FfmpegRunner>,
    config: Arc<RwLock<AppConfig>>,
}

impl WorkflowEngine {
    pub fn new(
        repo: Arc<Repository>,
        assets: Arc<AssetManager>,
        ffmpeg: Arc<FfmpegRunner>,
        config: Arc<RwLock<AppConfig>>,
    ) -> Self {
        Self {
            repo,
            assets,
            ffmpeg,
            config,
        }
    }

    pub async fn start(&self, task_id: &str, app: &AppHandle) -> AppResult<PipelineRun> {
        let task = self.require_task(task_id).await?;
        self.repo
            .update_task_status(task_id, TaskStatus::Running)
            .await?;
        self.repo
            .insert_log(Some(task_id), None, "info", "workflow started")
            .await?;
        let source_asset = self
            .assets
            .import_source_video(task_id, &task.source_path)
            .await?;
        self.repo.insert_asset(&source_asset).await?;
        let run = self.repo.create_run(task_id).await?;
        emit_pipeline_event(
            app,
            PipelineEvent::Run {
                run_id: run.id.clone(),
                task_id: task_id.to_string(),
                status: "RUNNING".to_string(),
            },
        );

        let runner = PipelineRunner::new(
            self.repo.clone(),
            self.assets.clone(),
            self.ffmpeg.clone(),
            self.config.clone(),
        );
        let app_handle = app.clone();
        let run_id = run.id.clone();
        let task_id_owned = task_id.to_string();
        tokio::spawn(async move {
            if let Err(error) = runner.run(&task_id_owned, &run_id, &app_handle).await {
                tracing::warn!("pipeline run {run_id} failed: {error}");
            }
        });

        Ok(run)
    }

    pub async fn cancel(&self, task_id: &str, app: &AppHandle) -> AppResult<()> {
        self.repo
            .update_task_status(task_id, TaskStatus::Canceled)
            .await?;
        let run = self.repo.latest_run(task_id).await?;
        self.repo
            .insert_log(
                Some(task_id),
                run.as_ref().map(|value| value.id.as_str()),
                "warn",
                "workflow canceled by user",
            )
            .await?;
        if let Some(run) = run {
            emit_pipeline_event(
                app,
                PipelineEvent::Run {
                    run_id: run.id,
                    task_id: task_id.to_string(),
                    status: "CANCELLED".to_string(),
                },
            );
        }
        Ok(())
    }

    async fn require_task(&self, task_id: &str) -> AppResult<crate::models::Task> {
        self.repo
            .get_task(task_id)
            .await?
            .ok_or_else(|| crate::errors::AppError::Workflow(format!("task not found: {task_id}")))
    }
}