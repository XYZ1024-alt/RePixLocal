use std::sync::Arc;

use tauri::AppHandle;
use tokio::sync::RwLock;

use crate::config::AppConfig;
use crate::db::Repository;
use crate::errors::AppResult;
use crate::media::ffmpeg::FfmpegRunner;
use crate::media::whisper::WhisperRunner;
use crate::models::{PipelineRun, TaskStatus, WorkflowTaskType};
use crate::storage::local_assets::AssetManager;
use crate::workflow::events::{emit_pipeline_event, PipelineEvent};
use crate::workflow::runner::PipelineRunner;

#[derive(Debug, Clone)]
pub struct WorkflowEngine {
    repo: Arc<Repository>,
    assets: Arc<AssetManager>,
    ffmpeg: Arc<FfmpegRunner>,
    whisper: Arc<WhisperRunner>,
    config: Arc<RwLock<AppConfig>>,
}

impl WorkflowEngine {
    pub fn new(
        repo: Arc<Repository>,
        assets: Arc<AssetManager>,
        ffmpeg: Arc<FfmpegRunner>,
        whisper: Arc<WhisperRunner>,
        config: Arc<RwLock<AppConfig>>,
    ) -> Self {
        Self {
            repo,
            assets,
            ffmpeg,
            whisper,
            config,
        }
    }

    pub async fn start(&self, task_id: &str, app: &AppHandle) -> AppResult<PipelineRun> {
        let task = self.require_task(task_id).await?;
        let run = self.repo.create_run(task_id).await?;
        self.prepare_started_run(&task, &run).await?;
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
            self.whisper.clone(),
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

    async fn prepare_started_run(
        &self,
        task: &crate::models::Task,
        run: &PipelineRun,
    ) -> AppResult<()> {
        if let Err(error) = self.prepare_run(task, &run.id).await {
            let message = error.to_string();
            if let Err(persist_error) = self
                .repo
                .fail_run_startup(&run.id, &task.id, &message)
                .await
            {
                return Err(crate::errors::AppError::Workflow(format!(
                    "{message}; failed to persist startup failure: {persist_error}"
                )));
            }
            return Err(error);
        }
        Ok(())
    }

    async fn prepare_run(&self, task: &crate::models::Task, run_id: &str) -> AppResult<()> {
        self.repo
            .insert_log(Some(&task.id), Some(run_id), "info", "workflow started")
            .await?;
        match task.task_type {
            WorkflowTaskType::Replicate => {
                let source = self
                    .assets
                    .import_source_video(&task.id, &task.source_path)
                    .await?;
                self.repo.insert_asset(&source).await
            }
            WorkflowTaskType::ImageToVideo => {
                let paths = image_paths_from_config(&task.config_json)?;
                let sources = self.assets.import_source_images(&task.id, &paths).await?;
                for source in sources {
                    self.repo.insert_asset(&source).await?;
                }
                Ok(())
            }
        }
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
        if let Some(run) = &run {
            if matches!(run.status, crate::models::RunStatus::Running) {
                self.repo.cancel_run(&run.id).await?;
            }
            emit_pipeline_event(
                app,
                PipelineEvent::Run {
                    run_id: run.id.clone(),
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

fn image_paths_from_config(config: &serde_json::Value) -> AppResult<Vec<String>> {
    let paths = config
        .get("imagePaths")
        .and_then(|value| value.as_array())
        .ok_or_else(|| {
            crate::errors::AppError::Workflow(
                "image_to_video task requires imagePaths in config".into(),
            )
        })?;
    let image_paths: Vec<String> = paths
        .iter()
        .filter_map(|value| value.as_str().map(str::to_string))
        .collect();
    if image_paths.is_empty() {
        return Err(crate::errors::AppError::Workflow(
            "image_to_video task requires at least one image".into(),
        ));
    }
    Ok(image_paths)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{CreateTaskInput, RunStatus};
    use crate::workspace::Workspace;
    use uuid::Uuid;

    #[tokio::test]
    async fn missing_source_marks_started_run_failed() {
        let (engine, repo) = test_engine().await;
        let task = repo
            .create_task(CreateTaskInput {
                title: "missing source".into(),
                source_path: "missing.mp4".into(),
                config_json: serde_json::json!({}),
            })
            .await
            .unwrap();
        let run = repo.create_run(&task.id).await.unwrap();

        let result = engine.prepare_started_run(&task, &run).await;

        assert!(result.is_err());
        let stored_run = repo.latest_run(&task.id).await.unwrap().unwrap();
        assert!(matches!(stored_run.status, RunStatus::Failed));
        let stored_task = repo.get_task(&task.id).await.unwrap().unwrap();
        assert!(matches!(stored_task.status, TaskStatus::Failed));
    }

    async fn test_engine() -> (WorkflowEngine, Arc<Repository>) {
        let root = std::env::temp_dir().join(format!("repix-engine-test-{}", Uuid::new_v4()));
        tokio::fs::create_dir_all(&root).await.unwrap();
        let workspace = Workspace::from_root(root);
        let repo = Arc::new(Repository::initialize(&workspace).await.unwrap());
        let config = Arc::new(RwLock::new(AppConfig::default_for(&workspace)));
        let assets = Arc::new(AssetManager::new(workspace));
        let ffmpeg = Arc::new(FfmpegRunner::new(config.clone()));
        let whisper = Arc::new(WhisperRunner::new(config.clone()));
        let engine = WorkflowEngine::new(repo.clone(), assets, ffmpeg, whisper, config);
        (engine, repo)
    }
}
