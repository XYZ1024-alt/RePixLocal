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
    pub config: RwLock<AppConfig>,
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
        ffmpeg: FfmpegRunner,
    ) -> Self {
        let repo = Arc::new(repo);
        let assets = Arc::new(assets);
        let ffmpeg = Arc::new(ffmpeg);
        let workflow = WorkflowEngine::new(repo.clone(), assets, ffmpeg.clone());
        Self {
            workspace,
            config: RwLock::new(config),
            repo,
            workflow,
            ffmpeg,
        }
    }
}
