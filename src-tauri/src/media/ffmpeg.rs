use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::RwLock;

use crate::config::AppConfig;
use crate::errors::{AppError, AppResult};
use crate::media::bundled_tools::{
    is_executable_file, resolve_tool_path, resolve_tool_path_with_source, ToolSource,
};
use crate::models::ToolCheck;

#[derive(Debug, Clone)]
pub struct FfmpegRunner {
    config: Arc<RwLock<AppConfig>>,
}

impl FfmpegRunner {
    pub fn new(config: Arc<RwLock<AppConfig>>) -> Self {
        Self { config }
    }

    pub async fn check_tools(&self) -> Vec<ToolCheck> {
        let config = self.config.read().await;
        vec![
            tool_check(
                "ffmpeg",
                "ffmpeg",
                config.ffmpeg_path.as_deref(),
                "ffmpeg",
            ),
            tool_check(
                "ffprobe",
                "ffprobe",
                config.ffprobe_path.as_deref(),
                "ffprobe",
            ),
        ]
    }

    pub async fn extract_audio(&self, video_path: &Path, out_wav: &Path) -> AppResult<()> {
        let ffmpeg = self.ffmpeg_path().await?;
        let status = Command::new(&ffmpeg)
            .args([
                "-y",
                "-i",
                &path_arg(video_path),
                "-vn",
                "-acodec",
                "pcm_s16le",
                "-ar",
                "16000",
                "-ac",
                "1",
                &path_arg(out_wav),
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .status()
            .await
            .map_err(AppError::from)?;
        if status.success() {
            return Ok(());
        }
        Err(AppError::Workflow("ffmpeg audio extraction failed".into()))
    }

    pub async fn concat_segments(&self, segment_paths: &[PathBuf], out_path: &Path) -> AppResult<()> {
        if segment_paths.is_empty() {
            return Err(AppError::Workflow("no segments to concatenate".into()));
        }
        let ffmpeg = self.ffmpeg_path().await?;
        let list_path = out_path.with_extension("concat.txt");
        let mut list_body = String::new();
        for segment in segment_paths {
            let normalized = segment.to_string_lossy().replace('\\', "/");
            list_body.push_str(&format!("file '{normalized}'\n"));
        }
        let mut file = tokio::fs::File::create(&list_path).await?;
        file.write_all(list_body.as_bytes()).await?;
        file.flush().await?;

        let status = Command::new(&ffmpeg)
            .args([
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                &path_arg(&list_path),
                "-c",
                "copy",
                &path_arg(out_path),
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .status()
            .await
            .map_err(AppError::from)?;
        let _ = tokio::fs::remove_file(&list_path).await;
        if status.success() {
            return Ok(());
        }
        Err(AppError::Workflow("ffmpeg concat failed".into()))
    }

    pub async fn probe_duration(&self, path: &Path) -> AppResult<f64> {
        let ffprobe = self.ffprobe_path().await?;
        let output = Command::new(&ffprobe)
            .args([
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                &path_arg(path),
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(AppError::from)?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Workflow(format!(
                "ffprobe duration probe failed: {}",
                stderr.trim()
            )));
        }
        let parsed: serde_json::Value = serde_json::from_slice(&output.stdout)?;
        parsed
            .get("format")
            .and_then(|value| value.get("duration"))
            .and_then(|value| value.as_str())
            .and_then(|value| value.parse::<f64>().ok())
            .ok_or_else(|| AppError::Workflow("ffprobe returned no duration".into()))
    }

    pub async fn extract_frames(
        &self,
        video_path: &Path,
        output_pattern: &Path,
        video_filter: &str,
    ) -> AppResult<()> {
        let ffmpeg = self.ffmpeg_path().await?;
        let status = Command::new(&ffmpeg)
            .args([
                "-y",
                "-i",
                &path_arg(video_path),
                "-vf",
                video_filter,
                "-vsync",
                "0",
                "-frame_pts",
                "1",
                &path_arg(output_pattern),
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .status()
            .await
            .map_err(AppError::from)?;
        if status.success() {
            return Ok(());
        }
        Err(AppError::Workflow("ffmpeg keyframe extraction failed".into()))
    }

    pub async fn render_final(
        &self,
        video_path: &Path,
        out_path: &Path,
        audio_path: Option<&Path>,
        subtitle_ass: Option<&Path>,
    ) -> AppResult<()> {
        if let Some(parent) = out_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let ffmpeg = self.ffmpeg_path().await?;
        let mut args = vec!["-y".to_string(), "-i".to_string(), path_arg(video_path)];
        if let Some(audio) = audio_path {
            args.push("-i".to_string());
            args.push(path_arg(audio));
        }

        let mut vf_parts = Vec::new();
        if let Some(audio) = audio_path {
            let video_duration = self.probe_duration(video_path).await?;
            let audio_duration = self.probe_duration(audio).await?;
            let pad = audio_duration - video_duration;
            if pad > 0.0 {
                vf_parts.push(format!("tpad=stop_mode=clone:stop_duration={:.3}", pad + 0.5));
            }
        }
        if let Some(ass_path) = subtitle_ass {
            vf_parts.push(format!("subtitles='{}'", escape_subtitles_filter_path(ass_path)));
        }

        if !vf_parts.is_empty() {
            args.push("-vf".to_string());
            args.push(vf_parts.join(","));
            args.push("-c:v".to_string());
            args.push("libx264".to_string());
        } else {
            args.push("-c:v".to_string());
            args.push("copy".to_string());
        }

        if audio_path.is_some() {
            args.extend([
                "-map".to_string(),
                "0:v:0".to_string(),
                "-map".to_string(),
                "1:a:0".to_string(),
                "-c:a".to_string(),
                "aac".to_string(),
                "-shortest".to_string(),
            ]);
        }

        args.push(path_arg(out_path));
        let status = Command::new(&ffmpeg)
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .status()
            .await
            .map_err(AppError::from)?;
        if status.success() {
            return Ok(());
        }
        Err(AppError::Workflow("ffmpeg final render failed".into()))
    }

    pub async fn copy_stream(&self, input: &Path, output: &Path) -> AppResult<()> {
        let ffmpeg = self.ffmpeg_path().await?;
        let status = Command::new(&ffmpeg)
            .args(["-y", "-i", &path_arg(input), "-c", "copy", &path_arg(output)])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .status()
            .await
            .map_err(AppError::from)?;
        if status.success() {
            return Ok(());
        }
        Err(AppError::Workflow("ffmpeg copy failed".into()))
    }

    async fn ffmpeg_path(&self) -> AppResult<PathBuf> {
        let config = self.config.read().await;
        resolve_tool_path(config.ffmpeg_path.as_deref(), "ffmpeg", "ffmpeg").ok_or_else(|| {
            AppError::Workflow("ffmpeg is not configured or not found in PATH".into())
        })
    }

    async fn ffprobe_path(&self) -> AppResult<PathBuf> {
        let config = self.config.read().await;
        resolve_tool_path(config.ffprobe_path.as_deref(), "ffprobe", "ffprobe").ok_or_else(|| {
            AppError::Workflow("ffprobe is not configured or not found in PATH".into())
        })
    }
}

fn path_arg(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn escape_subtitles_filter_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/").replace(':', "\\:")
}

fn tool_check(
    name: &str,
    sidecar_name: &str,
    configured: Option<&str>,
    fallback: &str,
) -> ToolCheck {
    match resolve_tool_path_with_source(configured, sidecar_name, fallback) {
        Some((path, source)) if path.exists() && is_executable_file(&path) => ToolCheck {
            name: name.to_string(),
            found: true,
            path: Some(path.to_string_lossy().to_string()),
            error: None,
            bundled: source == ToolSource::Bundled,
        },
        Some((path, source)) if path.exists() => ToolCheck {
            name: name.to_string(),
            found: true,
            path: Some(path.to_string_lossy().to_string()),
            error: None,
            bundled: source == ToolSource::Bundled,
        },
        Some((path, _)) => ToolCheck {
            name: name.to_string(),
            found: false,
            path: Some(path.to_string_lossy().to_string()),
            error: Some(format!("{name} path does not exist")),
            bundled: false,
        },
        None => ToolCheck {
            name: name.to_string(),
            found: false,
            path: None,
            error: Some(format!("{name} not found in PATH or bundled tools")),
            bundled: false,
        },
    }
}