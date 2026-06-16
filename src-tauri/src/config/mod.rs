use serde::{Deserialize, Serialize};
use tokio::fs;

use crate::errors::AppResult;
use crate::workspace::Workspace;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub workspace_root: String,
    pub ffmpeg_path: Option<String>,
    pub ffprobe_path: Option<String>,
}

impl AppConfig {
    pub fn default_for(workspace: &Workspace) -> Self {
        Self {
            workspace_root: workspace.root().to_string_lossy().to_string(),
            ffmpeg_path: None,
            ffprobe_path: None,
        }
    }
}

pub async fn load_or_create(workspace: &Workspace) -> AppResult<AppConfig> {
    let path = workspace.config_path();
    if !path.exists() {
        let config = AppConfig::default_for(workspace);
        save(workspace, &config).await?;
        return Ok(config);
    }

    let bytes = fs::read(path).await?;
    Ok(serde_json::from_slice(&bytes)?)
}

pub async fn save(workspace: &Workspace, config: &AppConfig) -> AppResult<()> {
    let bytes = serde_json::to_vec_pretty(config)?;
    fs::write(workspace.config_path(), bytes).await?;
    Ok(())
}
