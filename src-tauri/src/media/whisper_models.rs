use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::sync::RwLock;

use crate::errors::{AppError, AppResult};
use crate::providers::http_client::{build_http_client, format_http_error};
use crate::workspace::Workspace;

const HF_MODEL_BASE: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

#[derive(Debug, Clone, Default)]
pub struct DownloadState {
    pub downloading: bool,
    pub model_name: String,
    pub bytes_done: u64,
    pub bytes_total: Option<u64>,
    pub error: Option<String>,
}

static DOWNLOAD_STATE: std::sync::OnceLock<Arc<RwLock<DownloadState>>> = std::sync::OnceLock::new();

fn download_state() -> Arc<RwLock<DownloadState>> {
    DOWNLOAD_STATE
        .get_or_init(|| Arc::new(RwLock::new(DownloadState::default())))
        .clone()
}

pub fn model_file_name(model_name: &str) -> String {
    format!("ggml-{model_name}.bin")
}

pub fn model_path_for_dir(model_dir: &Path, model_name: &str) -> PathBuf {
    model_dir.join(model_file_name(model_name))
}

pub fn resolve_model_dir(workspace: &Workspace, configured: Option<&str>) -> PathBuf {
    configured
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| workspace.root().join("models").join("whisper"))
}

pub fn model_download_url(model_name: &str) -> String {
    format!("{HF_MODEL_BASE}/{}", model_file_name(model_name))
}

pub async fn get_download_state() -> DownloadState {
    download_state().read().await.clone()
}

pub async fn ensure_whisper_model(
    workspace: &Workspace,
    model_dir: Option<&str>,
    model_name: &str,
) -> AppResult<PathBuf> {
    let model_dir = resolve_model_dir(workspace, model_dir);
    tokio::fs::create_dir_all(&model_dir).await?;
    let target = model_path_for_dir(&model_dir, model_name);
    if target.exists() {
        clear_download_error().await;
        return Ok(target);
    }

    let state = download_state();
    {
        let guard = state.read().await;
        if guard.downloading && guard.model_name == model_name {
            return Err(AppError::Tool(format!(
                "whisper model download already in progress: {model_name}"
            )));
        }
    }

    {
        let mut guard = state.write().await;
        guard.downloading = true;
        guard.model_name = model_name.to_string();
        guard.bytes_done = 0;
        guard.bytes_total = None;
        guard.error = None;
    }

    let result = download_model(&target, model_name).await;
    {
        let mut guard = state.write().await;
        guard.downloading = false;
        if let Err(error) = &result {
            guard.error = Some(error.to_string());
        } else {
            guard.error = None;
        }
    }
    result
}

async fn clear_download_error() {
    let state = download_state();
    let mut guard = state.write().await;
    guard.error = None;
}

async fn download_model(target: &Path, model_name: &str) -> AppResult<PathBuf> {
    let url = model_download_url(model_name);
    let client = build_http_client(3600)?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|error| AppError::Tool(format_http_error(&url, &error)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::Tool(format!(
            "failed to download whisper model ({status}): {body}"
        )));
    }

    let total = response.content_length();
    {
        let state = download_state();
        let mut guard = state.write().await;
        guard.bytes_total = total;
    }

    let parent = target
        .parent()
        .ok_or_else(|| AppError::Tool("invalid whisper model path".into()))?;
    let temp_path = parent.join(format!(
        ".{}-{}.download",
        target
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("model"),
        uuid::Uuid::new_v4()
    ));

    let bytes = response
        .bytes()
        .await
        .map_err(|error| AppError::Tool(error.to_string()))?;
    {
        let state = download_state();
        let mut guard = state.write().await;
        guard.bytes_done = bytes.len() as u64;
        if guard.bytes_total.is_none() {
            guard.bytes_total = Some(bytes.len() as u64);
        }
    }
    tokio::fs::write(&temp_path, &bytes).await?;

    tokio::fs::rename(&temp_path, target)
        .await
        .map_err(|error| {
            let _ = std::fs::remove_file(&temp_path);
            AppError::Tool(format!(
                "failed to finalize whisper model download: {error}"
            ))
        })?;
    Ok(target.to_path_buf())
}

pub fn model_status(
    workspace: &Workspace,
    model_dir: Option<&str>,
    model_name: &str,
) -> crate::models::WhisperModelStatus {
    let model_dir = resolve_model_dir(workspace, model_dir);
    let path = model_path_for_dir(&model_dir, model_name);
    crate::models::WhisperModelStatus {
        model_name: model_name.to_string(),
        downloaded: path.exists(),
        path: path.to_string_lossy().to_string(),
        downloading: false,
        bytes_done: 0,
        bytes_total: None,
        error: None,
    }
}
