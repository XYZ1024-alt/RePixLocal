use std::path::{Path, PathBuf};
use std::sync::Arc;

use futures_util::StreamExt;
use tokio::io::AsyncWriteExt;
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

fn begin_download(state: &mut DownloadState, model_name: &str) -> AppResult<()> {
    if state.downloading {
        return Err(AppError::Tool(format!(
            "whisper model download already in progress: {}",
            state.model_name
        )));
    }

    state.downloading = true;
    state.model_name = model_name.to_string();
    state.bytes_done = 0;
    state.bytes_total = None;
    state.error = None;
    Ok(())
}

fn finish_download(state: &mut DownloadState, model_name: &str, error: Option<String>) {
    if !state.downloading || state.model_name != model_name {
        return;
    }
    state.downloading = false;
    state.error = error;
}

struct DownloadLease {
    state: Arc<RwLock<DownloadState>>,
    model_name: String,
    finished: bool,
}

impl DownloadLease {
    fn new(state: Arc<RwLock<DownloadState>>, model_name: &str) -> Self {
        Self {
            state,
            model_name: model_name.to_string(),
            finished: false,
        }
    }

    async fn finish(&mut self, result: &AppResult<PathBuf>) {
        let error = result.as_ref().err().map(ToString::to_string);
        let mut state = self.state.write().await;
        finish_download(&mut state, &self.model_name, error);
        self.finished = true;
    }
}

impl Drop for DownloadLease {
    fn drop(&mut self) {
        if self.finished {
            return;
        }

        let error = Some("whisper model download canceled".to_string());
        if let Ok(mut state) = self.state.try_write() {
            finish_download(&mut state, &self.model_name, error);
            return;
        }

        let state = self.state.clone();
        let model_name = self.model_name.clone();
        match tokio::runtime::Handle::try_current() {
            Ok(handle) => {
                handle.spawn(async move {
                    let mut state = state.write().await;
                    finish_download(
                        &mut state,
                        &model_name,
                        Some("whisper model download canceled".to_string()),
                    );
                });
            }
            Err(runtime_error) => {
                tracing::error!(
                    %runtime_error,
                    model = %self.model_name,
                    "failed to release canceled Whisper model download"
                );
            }
        }
    }
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
        let mut guard = state.write().await;
        begin_download(&mut guard, model_name)?;
    }

    let mut lease = DownloadLease::new(state, model_name);
    let result = download_model(&target, model_name).await;
    lease.finish(&result).await;
    result
}

async fn clear_download_error() {
    let state = download_state();
    let mut guard = state.write().await;
    guard.error = None;
}

async fn download_model(target: &Path, model_name: &str) -> AppResult<PathBuf> {
    let url = model_download_url(model_name);
    download_model_from_url(target, &url).await
}

async fn download_model_from_url(target: &Path, url: &str) -> AppResult<PathBuf> {
    let client = build_http_client(3600)?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| AppError::Tool(format_http_error(url, &error)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::Tool(format!(
            "failed to download whisper model ({status}): {body}"
        )));
    }

    set_download_total(response.content_length()).await;
    let temp = DownloadTempFile::new(download_temp_path(target)?);
    if let Err(error) = write_model_response(response, temp.path()).await {
        return Err(cleanup_failed_download(temp.path(), error).await);
    }

    if let Err(error) = tokio::fs::rename(temp.path(), target).await {
        let error = AppError::Tool(format!(
            "failed to finalize whisper model download: {error}"
        ));
        return Err(cleanup_failed_download(temp.path(), error).await);
    }
    temp.persist();
    Ok(target.to_path_buf())
}

fn download_temp_path(target: &Path) -> AppResult<PathBuf> {
    let parent = target
        .parent()
        .ok_or_else(|| AppError::Tool("invalid whisper model path".into()))?;
    Ok(parent.join(format!(
        ".{}-{}.download",
        target
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("model"),
        uuid::Uuid::new_v4()
    )))
}

async fn set_download_total(total: Option<u64>) {
    let state = download_state();
    let mut guard = state.write().await;
    guard.bytes_total = total;
}

async fn write_model_response(response: reqwest::Response, temp_path: &Path) -> AppResult<()> {
    let mut file = tokio::fs::File::create(temp_path).await.map_err(|error| {
        AppError::Tool(format!(
            "failed to create temporary file for whisper model download: {error}"
        ))
    })?;

    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| AppError::Tool(error.to_string()))?;
        file.write_all(&chunk)
            .await
            .map_err(|error| AppError::Tool(format!("failed to write model chunk: {error}")))?;
        downloaded += chunk.len() as u64;
        let state = download_state();
        let mut guard = state.write().await;
        guard.bytes_done = downloaded;
    }

    {
        let state = download_state();
        let mut guard = state.write().await;
        if guard.bytes_total.is_none() {
            guard.bytes_total = Some(downloaded);
        }
    }

    file.flush()
        .await
        .map_err(|error| AppError::Tool(format!("failed to flush model file: {error}")))?;
    Ok(())
}

async fn cleanup_failed_download(temp_path: &Path, error: AppError) -> AppError {
    match tokio::fs::remove_file(temp_path).await {
        Ok(()) => error,
        Err(cleanup_error) if cleanup_error.kind() == std::io::ErrorKind::NotFound => error,
        Err(cleanup_error) => AppError::Tool(format!(
            "{error}; failed to remove temporary model file {}: {cleanup_error}",
            temp_path.display()
        )),
    }
}

struct DownloadTempFile {
    path: PathBuf,
    remove_on_drop: bool,
}

impl DownloadTempFile {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            remove_on_drop: true,
        }
    }

    fn path(&self) -> &Path {
        &self.path
    }

    fn persist(mut self) {
        self.remove_on_drop = false;
    }
}

impl Drop for DownloadTempFile {
    fn drop(&mut self) {
        if !self.remove_on_drop {
            return;
        }
        if let Err(error) = std::fs::remove_file(&self.path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!(
                    path = %self.path.display(),
                    %error,
                    "failed to clean up temporary Whisper model file"
                );
            }
        }
    }
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

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    use super::*;

    #[test]
    fn active_download_rejects_parallel_model_without_overwriting_state() {
        let mut state = DownloadState::default();
        begin_download(&mut state, "base").unwrap();

        let error = begin_download(&mut state, "large").unwrap_err();

        assert!(error.to_string().contains("base"));
        assert!(state.downloading);
        assert_eq!(state.model_name, "base");
        assert_eq!(state.bytes_done, 0);
        assert_eq!(state.bytes_total, None);
        assert_eq!(state.error, None);
    }

    #[tokio::test]
    async fn dropped_download_lease_releases_active_state() {
        let state = Arc::new(RwLock::new(DownloadState::default()));
        {
            let mut guard = state.write().await;
            begin_download(&mut guard, "base").unwrap();
        }

        drop(DownloadLease::new(state.clone(), "base"));

        let guard = state.read().await;
        assert!(!guard.downloading);
        assert_eq!(guard.model_name, "base");
        assert_eq!(
            guard.error.as_deref(),
            Some("whisper model download canceled")
        );
    }

    #[tokio::test]
    async fn interrupted_download_removes_temporary_file() {
        let url = serve_once(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nshort");
        let dir = test_dir();
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let target = dir.join("ggml-base.bin");

        let error = download_model_from_url(&target, &url).await.unwrap_err();

        assert!(!error.to_string().is_empty());
        assert!(!target.exists());
        assert!(download_temp_files(&dir).is_empty());
        let _ = tokio::fs::remove_dir_all(dir).await;
    }

    #[tokio::test]
    async fn completed_download_persists_only_target_file() {
        let url = serve_once(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\ndata");
        let dir = test_dir();
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let target = dir.join("ggml-base.bin");

        download_model_from_url(&target, &url).await.unwrap();

        assert_eq!(tokio::fs::read(&target).await.unwrap(), b"data");
        assert!(download_temp_files(&dir).is_empty());
        let _ = tokio::fs::remove_dir_all(dir).await;
    }

    fn serve_once(response: &'static [u8]) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 1024];
            let _ = stream.read(&mut request);
            stream.write_all(response).unwrap();
        });
        format!("http://{address}/model")
    }

    fn test_dir() -> PathBuf {
        std::env::temp_dir().join(format!("repix-whisper-test-{}", uuid::Uuid::new_v4()))
    }

    fn download_temp_files(dir: &Path) -> Vec<PathBuf> {
        std::fs::read_dir(dir)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("download"))
            .collect()
    }
}
