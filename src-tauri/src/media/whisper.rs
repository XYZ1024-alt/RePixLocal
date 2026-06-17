use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use serde::Deserialize;
use tokio::process::Command;
use tokio::sync::RwLock;

use crate::config::AppConfig;
use crate::errors::{AppError, AppResult};
use crate::models::{ToolCheck, TranscriptResult, TranscriptSegment};
const WHISPER_BINARY_CANDIDATES: [&str; 3] = ["whisper-cli", "whisper", "main"];

#[derive(Debug, Clone)]
pub struct WhisperRunner {
    config: Arc<RwLock<AppConfig>>,
}

impl WhisperRunner {
    pub fn new(config: Arc<RwLock<AppConfig>>) -> Self {
        Self { config }
    }

    pub async fn check_tool(&self) -> ToolCheck {
        let config = self.config.read().await;
        let binary = resolve_whisper_binary(config.whisper_bin.as_deref());
        let model = resolve_model_path(&config, config.asr_model.as_deref().unwrap_or("base"));
        let model_error = model.as_ref().err().map(|error| error.to_string());
        match (&binary, model.as_ref()) {
            (Some(path), Ok(model_path)) if path.exists() && model_path.exists() => ToolCheck {
                name: "whisper".to_string(),
                found: true,
                path: Some(path.to_string_lossy().to_string()),
                error: None,
            },
            (Some(path), Ok(model_path)) => ToolCheck {
                name: "whisper".to_string(),
                found: false,
                path: Some(path.to_string_lossy().to_string()),
                error: Some(format!(
                    "whisper binary found but model missing: {}",
                    model_path.display()
                )),
            },
            (Some(path), Err(_)) => ToolCheck {
                name: "whisper".to_string(),
                found: false,
                path: Some(path.to_string_lossy().to_string()),
                error: model_error,
            },
            (None, _) => ToolCheck {
                name: "whisper".to_string(),
                found: false,
                path: None,
                error: Some(
                    "whisper-cli not found in PATH; set whisper_bin in settings".into(),
                ),
            },
        }
    }

    pub async fn transcribe(
        &self,
        audio_path: &Path,
        language: Option<&str>,
        output_prefix: &Path,
    ) -> AppResult<TranscriptResult> {
        let config = self.config.read().await;
        let binary = resolve_whisper_binary(config.whisper_bin.as_deref()).ok_or_else(|| {
            AppError::Tool("whisper-cli is not configured or not found in PATH".into())
        })?;
        let model_name = config.asr_model.as_deref().unwrap_or("base");
        let model_path = resolve_model_path(&config, model_name)?;
        if !model_path.exists() {
            return Err(AppError::Tool(format!(
                "whisper model not found: {} (download ggml-{model_name}.bin)",
                model_path.display()
            )));
        }

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

        let output = Command::new(&binary)
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(AppError::from)?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Tool(format!(
                "whisper transcription failed: {}",
                stderr.trim()
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
    if let Some(path) = configured.filter(|value| !value.trim().is_empty()) {
        let candidate = PathBuf::from(path);
        if candidate.exists() {
            return Some(candidate);
        }
        return Some(candidate);
    }
    WHISPER_BINARY_CANDIDATES
        .iter()
        .find_map(|name| which::which(name).ok())
}

fn resolve_model_path(config: &AppConfig, model_name: &str) -> AppResult<PathBuf> {
    let file_name = format!("ggml-{model_name}.bin");
    if let Some(dir) = config
        .whisper_model_dir
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let candidate = PathBuf::from(dir).join(&file_name);
        if candidate.exists() {
            return Ok(candidate);
        }
        return Err(AppError::Tool(format!(
            "whisper model not found: {} (expected ggml-{model_name}.bin)",
            candidate.display()
        )));
    }
    Err(AppError::Tool(format!(
        "whisper_model_dir is not configured; place {file_name} there and set the path in settings"
    )))
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