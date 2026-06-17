use serde::{Deserialize, Serialize};
use tokio::fs;

use crate::errors::AppResult;
use crate::storage::oss::merge_secret_on_save;
use crate::workspace::Workspace;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub workspace_root: String,
    pub ffmpeg_path: Option<String>,
    pub ffprobe_path: Option<String>,
    pub asr_model: Option<String>,
    #[serde(default = "default_mock_providers")]
    pub mock_providers: bool,
    pub whisper_bin: Option<String>,
    pub whisper_model_dir: Option<String>,
    #[serde(default)]
    pub s3_endpoint: Option<String>,
    #[serde(default)]
    pub s3_public_endpoint: Option<String>,
    #[serde(default)]
    pub s3_bucket: Option<String>,
    #[serde(default)]
    pub s3_access_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub s3_secret_key_encrypted: Option<String>,
    #[serde(default, skip_serializing, skip_deserializing)]
    pub s3_secret_configured: bool,
    #[serde(default, skip_serializing)]
    pub s3_secret_key: Option<String>,
    #[serde(default, skip_serializing, skip_deserializing)]
    pub s3_secret_decrypt_failed: bool,
}

fn default_mock_providers() -> bool {
    true
}

impl AppConfig {
    pub fn default_for(workspace: &Workspace) -> Self {
        Self {
            workspace_root: workspace.root().to_string_lossy().to_string(),
            ffmpeg_path: None,
            ffprobe_path: None,
            asr_model: Some("base".to_string()),
            mock_providers: true,
            whisper_bin: None,
            whisper_model_dir: Some(default_whisper_model_dir(workspace)),
            s3_endpoint: None,
            s3_public_endpoint: None,
            s3_bucket: None,
            s3_access_key: None,
            s3_secret_key_encrypted: None,
            s3_secret_configured: false,
            s3_secret_key: None,
            s3_secret_decrypt_failed: false,
        }
    }
}

fn default_whisper_model_dir(workspace: &Workspace) -> String {
    workspace
        .root()
        .join("models")
        .join("whisper")
        .to_string_lossy()
        .to_string()
}

pub async fn load_or_create(workspace: &Workspace) -> AppResult<AppConfig> {
    let path = workspace.config_path();
    if !path.exists() {
        let config = AppConfig::default_for(workspace);
        let persisted = save(workspace, &config).await?;
        return Ok(persisted);
    }

    let bytes = fs::read(path).await?;
    Ok(serde_json::from_slice(&bytes)?)
}

pub async fn save(workspace: &Workspace, config: &AppConfig) -> AppResult<AppConfig> {
    let mut persisted = config.clone();
    merge_secret_on_save(&mut persisted)?;
    persisted.s3_secret_key = None;
    persisted.s3_secret_decrypt_failed = false;
    let bytes = serde_json::to_vec_pretty(&persisted)?;
    fs::write(workspace.config_path(), bytes).await?;
    Ok(persisted)
}
