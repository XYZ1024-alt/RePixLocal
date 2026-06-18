use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use serde::Deserialize;
use tokio::process::Command;
use tokio::sync::RwLock;

use crate::config::AppConfig;
use crate::errors::{AppError, AppResult};
use crate::media::bundled_tools::{
    is_executable_file, resolve_tool_path_with_source, ToolSource,
};
use crate::media::whisper_models;
use crate::media::whisper_runtime::{
    format_process_failure, whisper_runtime_ready, whisper_runtime_search_dir,
};
use crate::models::{ToolCheck, TranscriptResult, TranscriptSegment};
use crate::workspace::Workspace;

const WHISPER_PATH_CANDIDATES: [&str; 2] = ["whisper-cli", "whisper"];

#[derive(Debug, Clone)]
pub struct WhisperRunner {
    config: Arc<RwLock<AppConfig>>,
}

impl WhisperRunner {
    pub fn new(config: Arc<RwLock<AppConfig>>) -> Self {
        Self { config }
    }

    pub async fn ensure_model(&self, workspace: &Workspace) -> AppResult<PathBuf> {
        let config = self.config.read().await;
        let model_name = config.asr_model.as_deref().unwrap_or("base");
        whisper_models::ensure_whisper_model(
            workspace,
            config.whisper_model_dir.as_deref(),
            model_name,
        )
        .await
    }

    pub async fn check_tool(&self, workspace: &Workspace) -> ToolCheck {
        let config = self.config.read().await;
        let model_name = config.asr_model.as_deref().unwrap_or("base");
        let binary = resolve_whisper_binary_with_source(config.whisper_bin.as_deref());
        let model_path = whisper_models::model_path_for_dir(
            &whisper_models::resolve_model_dir(
                workspace,
                config.whisper_model_dir.as_deref(),
            ),
            model_name,
        );
        let model_error = if model_path.exists() {
            None
        } else {
            Some(format!(
                "whisper model missing: {} (expected ggml-{model_name}.bin)",
                model_path.display()
            ))
        };

        match binary {
            Some((path, source))
                if path.exists()
                    && is_executable_file(&path)
                    && model_path.exists()
                    && whisper_runtime_search_dir(&path).is_some() =>
            {
                ToolCheck {
                    name: "whisper".to_string(),
                    found: true,
                    path: Some(path.to_string_lossy().to_string()),
                    error: None,
                    bundled: source == ToolSource::Bundled,
                }
            }
            Some((path, source)) if path.exists() && is_executable_file(&path) && !whisper_runtime_ready(path.parent().unwrap_or(Path::new("."))) => ToolCheck {
                name: "whisper".to_string(),
                found: false,
                path: Some(path.to_string_lossy().to_string()),
                error: Some(
                    "whisper runtime DLLs missing next to whisper-cli; rerun bun run fetch-tools and restart"
                        .into(),
                ),
                bundled: source == ToolSource::Bundled,
            },
            Some((path, source)) if path.exists() && is_executable_file(&path) => ToolCheck {
                name: "whisper".to_string(),
                found: false,
                path: Some(path.to_string_lossy().to_string()),
                error: model_error,
                bundled: source == ToolSource::Bundled,
            },
            Some((path, source)) => ToolCheck {
                name: "whisper".to_string(),
                found: false,
                path: Some(path.to_string_lossy().to_string()),
                error: Some("whisper-cli path is not a valid executable".into()),
                bundled: source == ToolSource::Bundled,
            },
            None => ToolCheck {
                name: "whisper".to_string(),
                found: false,
                path: None,
                error: Some(
                    "whisper-cli not found; bundled tool missing or set whisper_bin in settings"
                        .into(),
                ),
                bundled: false,
            },
        }
    }

    pub async fn transcribe(
        &self,
        workspace: &Workspace,
        audio_path: &Path,
        language: Option<&str>,
        output_prefix: &Path,
    ) -> AppResult<TranscriptResult> {
        let model_path = self.ensure_model(workspace).await?;
        let config = self.config.read().await;
        let binary = resolve_whisper_binary(config.whisper_bin.as_deref()).ok_or_else(|| {
            AppError::Tool("whisper-cli is not configured or not found".into())
        })?;

        if let Some(parent) = output_prefix.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let json_path = output_prefix.with_extension("json");
        let _ = tokio::fs::remove_file(&json_path).await;

        let mut args = vec![
            "-m".to_string(),
            path_arg(&model_path),
            "-f".to_string(),
            path_arg(audio_path),
            "-oj".to_string(),
            "-of".to_string(),
            path_arg(output_prefix),
            "-np".to_string(),
        ];
        if let Some(language) = language.filter(|value| !value.is_empty() && *value != "auto") {
            args.push("-l".to_string());
            args.push(language.to_string());
        }

        let mut command = Command::new(&binary);
        command
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(runtime_dir) = whisper_runtime_search_dir(&binary) {
            let path = std::env::var_os("PATH").unwrap_or_default();
            let joined = std::env::join_paths([runtime_dir.as_os_str(), path.as_os_str()]).ok();
            if let Some(value) = joined {
                command.env("PATH", value);
            }
        }

        let output = command.output().await.map_err(AppError::from)?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            return Err(AppError::Tool(format!(
                "whisper transcription failed: {}",
                format_process_failure(output.status.code(), &stdout, &stderr)
            )));
        }

        let body = tokio::fs::read_to_string(&json_path).await.map_err(|error| {
            AppError::Tool(format!(
                "whisper JSON output not found at {}: {error}",
                json_path.display()
            ))
        })?;
        parse_whisper_json(&body)
    }
}

fn resolve_whisper_binary(configured: Option<&str>) -> Option<PathBuf> {
    resolve_whisper_binary_with_source(configured).map(|(path, _)| path)
}

fn resolve_whisper_binary_with_source(
    configured: Option<&str>,
) -> Option<(PathBuf, ToolSource)> {
    if let Some(result) =
        resolve_tool_path_with_source(configured, "whisper-cli", "whisper-cli")
    {
        return Some(result);
    }
    WHISPER_PATH_CANDIDATES.iter().find_map(|name| {
        which::which(name)
            .ok()
            .filter(|path| is_executable_file(path))
            .map(|path| (path, ToolSource::SystemPath))
    })
}

fn parse_whisper_json(body: &str) -> AppResult<TranscriptResult> {
    let parsed: WhisperJson = serde_json::from_str(body)?;
    let language = parsed
        .result
        .and_then(|value| value.language)
        .unwrap_or_else(|| "auto".to_string());
    let segments = parsed
        .transcription
        .into_iter()
        .filter_map(parse_whisper_segment)
        .collect::<Vec<_>>();
    let text = segments
        .iter()
        .map(|segment| segment.text.trim())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    Ok(TranscriptResult {
        language,
        segments,
        text,
    })
}

fn parse_whisper_segment(entry: WhisperSegmentJson) -> Option<TranscriptSegment> {
    let text = entry.text?.trim().to_string();
    if text.is_empty() {
        return None;
    }
    let (start_ms, end_ms) = if let Some(offsets) = entry.offsets {
        (offsets.from, offsets.to)
    } else if let Some(timestamps) = entry.timestamps {
        (
            parse_timestamp_ms(&timestamps.from)?,
            parse_timestamp_ms(&timestamps.to)?,
        )
    } else {
        return None;
    };
    Some(TranscriptSegment {
        start_ms,
        end_ms,
        text,
    })
}

fn parse_timestamp_ms(value: &str) -> Option<i64> {
    let value = value.trim();
    if value.chars().all(|ch| ch.is_ascii_digit()) {
        return value.parse().ok();
    }
    let (hours_minutes, millis) = value.split_once(',')?;
    let millis: i64 = millis.parse().ok()?;
    let mut parts = hours_minutes.split(':');
    let hours: i64 = parts.next()?.parse().ok()?;
    let minutes: i64 = parts.next()?.parse().ok()?;
    let seconds: i64 = parts.next()?.parse().ok()?;
    Some(hours * 3_600_000 + minutes * 60_000 + seconds * 1_000 + millis)
}

fn path_arg(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[derive(Debug, Deserialize)]
struct WhisperJson {
    #[serde(default)]
    transcription: Vec<WhisperSegmentJson>,
    result: Option<WhisperResultJson>,
}

#[derive(Debug, Deserialize)]
struct WhisperResultJson {
    language: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WhisperSegmentJson {
    text: Option<String>,
    offsets: Option<WhisperOffsetsJson>,
    timestamps: Option<WhisperTimestampsJson>,
}

#[derive(Debug, Deserialize)]
struct WhisperOffsetsJson {
    from: i64,
    to: i64,
}

#[derive(Debug, Deserialize)]
struct WhisperTimestampsJson {
    from: String,
    to: String,
}