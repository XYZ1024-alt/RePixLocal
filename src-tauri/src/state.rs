use std::sync::Arc;

use tokio::sync::RwLock;

use crate::config::AppConfig;
use crate::db::Repository;
use crate::media::ffmpeg::FfmpegRunner;
use crate::storage::local_assets::AssetManager;
use crate::workflow::engine::WorkflowEngine;
use crate::workspace::Workspace;

#[derive(Debug)]
pub struct AppState {
    pub workspace: Workspace,
    pub config: Arc<RwLock<AppConfig>>,
    pub repo: Arc<Repository>,
    pub workflow: WorkflowEngine,
    pub ffmpeg: Arc<FfmpegRunner>,
}

impl AppState {
    pub fn new(
        workspace: Workspace,
        config: AppConfig,
        repo: Repository,
        assets: AssetManager,
    ) -> Self {
        let config = Arc::new(RwLock::new(config));
        let repo = Arc::new(repo);
        let assets = Arc::new(assets);
        let ffmpeg = Arc::new(FfmpegRunner::new(config.clone()));
        let workflow = WorkflowEngine::new(repo.clone(), assets, ffmpeg.clone(), config.clone());
        Self {
            workspace,
            config,
            repo,
            workflow,
            ffmpeg,
        }
    }
}