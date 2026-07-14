use std::collections::HashMap;
use std::sync::Arc;

use tauri::AppHandle;
use tokio::sync::{Mutex, RwLock};
use tokio::task::JoinHandle;

use crate::config::AppConfig;
use crate::db::Repository;
use crate::errors::AppResult;
use crate::media::ffmpeg::FfmpegRunner;
use crate::media::whisper::WhisperRunner;
use crate::models::{PipelineRun, TaskStatus, WorkflowTaskType};
use crate::providers::video_capabilities;
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
    coordinator: Arc<RunCoordinator>,
}

#[derive(Debug, Default)]
struct RunCoordinator {
    task_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    active_runs: Mutex<HashMap<String, ActiveRun>>,
}

#[derive(Debug)]
struct ActiveRun {
    run_id: String,
    handle: JoinHandle<()>,
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
            coordinator: Arc::new(RunCoordinator::default()),
        }
    }

    pub async fn start(&self, task_id: &str, app: &AppHandle) -> AppResult<PipelineRun> {
        let task_lock = self.coordinator.task_lock(task_id).await;
        let _task_guard = task_lock.lock().await;
        let mut task = self.require_task(task_id).await?;
        self.coordinator
            .wait_for_previous_run(task_id, &task.status)
            .await?;
        task = self.require_task(task_id).await?;
        if !self.config.read().await.mock_providers {
            video_capabilities::selection_from_config(&task.config_json)?;
        }
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
        let handle = tokio::spawn(async move {
            if let Err(error) = runner.run(&task_id_owned, &run_id, &app_handle).await {
                tracing::warn!("pipeline run {run_id} failed: {error}");
            }
        });
        self.coordinator
            .register(task_id, run.id.clone(), handle)
            .await;

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
        let task_lock = self.coordinator.task_lock(task_id).await;
        let _task_guard = task_lock.lock().await;
        self.require_task(task_id).await?;
        let tracked_run_id = self.coordinator.active_run_id(task_id).await;
        let run = self.repo.latest_run(task_id).await?;
        let run_id = match (tracked_run_id, run) {
            (Some(run_id), _) => run_id,
            (None, Some(run)) if matches!(run.status, crate::models::RunStatus::Running) => run.id,
            _ => return Ok(()),
        };
        if !self.repo.cancel_active_run(&run_id, task_id).await? {
            return Ok(());
        }
        self.repo
            .insert_log(
                Some(task_id),
                Some(&run_id),
                "warn",
                "workflow canceled by user",
            )
            .await?;
        emit_pipeline_event(
            app,
            PipelineEvent::Run {
                run_id,
                task_id: task_id.to_string(),
                status: "CANCELLED".to_string(),
            },
        );
        Ok(())
    }

    async fn require_task(&self, task_id: &str) -> AppResult<crate::models::Task> {
        self.repo
            .get_task(task_id)
            .await?
            .ok_or_else(|| crate::errors::AppError::Workflow(format!("task not found: {task_id}")))
    }
}

impl RunCoordinator {
    async fn task_lock(&self, task_id: &str) -> Arc<Mutex<()>> {
        let mut task_locks = self.task_locks.lock().await;
        task_locks
            .entry(task_id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    async fn wait_for_previous_run(
        &self,
        task_id: &str,
        task_status: &TaskStatus,
    ) -> AppResult<()> {
        let active = self.active_runs.lock().await.remove(task_id);
        let Some(active) = active else {
            return Ok(());
        };
        if matches!(task_status, TaskStatus::Running) && !active.handle.is_finished() {
            self.active_runs
                .lock()
                .await
                .insert(task_id.to_string(), active);
            return Err(crate::errors::AppError::Workflow(format!(
                "task already has an active runner: {task_id}"
            )));
        }
        active.handle.await.map_err(|error| {
            crate::errors::AppError::Workflow(format!(
                "previous runner for task {task_id} did not exit cleanly: {error}"
            ))
        })
    }

    async fn register(&self, task_id: &str, run_id: String, handle: JoinHandle<()>) {
        let previous = self
            .active_runs
            .lock()
            .await
            .insert(task_id.to_string(), ActiveRun { run_id, handle });
        debug_assert!(previous.is_none(), "active runner replaced without waiting");
    }

    async fn active_run_id(&self, task_id: &str) -> Option<String> {
        self.active_runs
            .lock()
            .await
            .get(task_id)
            .map(|active| active.run_id.clone())
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
    use std::time::Duration;
    use tokio::sync::Notify;
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

    #[tokio::test]
    async fn terminal_task_waits_for_previous_runner_to_exit() {
        let coordinator = Arc::new(RunCoordinator::default());
        let release = Arc::new(Notify::new());
        let handle = tokio::spawn({
            let release = release.clone();
            async move { release.notified().await }
        });
        coordinator.register("task-1", "run-1".into(), handle).await;

        let mut waiter = tokio::spawn({
            let coordinator = coordinator.clone();
            async move {
                coordinator
                    .wait_for_previous_run("task-1", &TaskStatus::Canceled)
                    .await
            }
        });

        assert!(tokio::time::timeout(Duration::from_millis(25), &mut waiter)
            .await
            .is_err());
        release.notify_one();
        waiter.await.unwrap().unwrap();
        assert!(coordinator.active_run_id("task-1").await.is_none());
    }

    #[tokio::test]
    async fn running_task_rejects_a_second_live_runner() {
        let coordinator = RunCoordinator::default();
        let release = Arc::new(Notify::new());
        let handle = tokio::spawn({
            let release = release.clone();
            async move { release.notified().await }
        });
        coordinator.register("task-1", "run-1".into(), handle).await;

        let result = coordinator
            .wait_for_previous_run("task-1", &TaskStatus::Running)
            .await;

        assert!(result.is_err());
        assert_eq!(
            coordinator.active_run_id("task-1").await.as_deref(),
            Some("run-1")
        );
        release.notify_one();
        coordinator
            .wait_for_previous_run("task-1", &TaskStatus::Canceled)
            .await
            .unwrap();
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
