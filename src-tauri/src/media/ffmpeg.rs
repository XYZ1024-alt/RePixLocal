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
            tool_check("ffmpeg", "ffmpeg", config.ffmpeg_path.as_deref(), "ffmpeg"),
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

    pub async fn concat_audio(&self, audio_paths: &[PathBuf], out_path: &Path) -> AppResult<()> {
        if audio_paths.is_empty() {
            return Err(AppError::Workflow(
                "no audio segments to concatenate".into(),
            ));
        }
        if audio_paths.len() == 1 {
            return self.convert_to_wav(&audio_paths[0], out_path).await;
        }
        let ffmpeg = self.ffmpeg_path().await?;
        let list_path = out_path.with_extension("audio-concat.txt");
        let mut list_body = String::new();
        for audio in audio_paths {
            let normalized = audio.to_string_lossy().replace('\\', "/");
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
                "-acodec",
                "pcm_s16le",
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
        Err(AppError::Workflow("ffmpeg audio concat failed".into()))
    }

    pub async fn convert_to_wav(&self, input: &Path, out_wav: &Path) -> AppResult<()> {
        if let Some(parent) = out_wav.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let ffmpeg = self.ffmpeg_path().await?;
        let status = Command::new(&ffmpeg)
            .args([
                "-y",
                "-i",
                &path_arg(input),
                "-acodec",
                "pcm_s16le",
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
        Err(AppError::Workflow("ffmpeg audio conversion failed".into()))
    }

    pub async fn create_still_segment(
        &self,
        image_path: &Path,
        out_path: &Path,
        duration_sec: f64,
    ) -> AppResult<()> {
        if let Some(parent) = out_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let ffmpeg = self.ffmpeg_path().await?;
        let duration = format!("{duration_sec:.3}");
        let filter = format!(
            "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2"
        );
        let status = Command::new(&ffmpeg)
            .args([
                "-y",
                "-loop",
                "1",
                "-i",
                &path_arg(image_path),
                "-t",
                &duration,
                "-vf",
                &filter,
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                &path_arg(out_path),
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
        Err(AppError::Workflow("ffmpeg still segment failed".into()))
    }

    pub async fn concat_segments(
        &self,
        segment_paths: &[PathBuf],
        out_path: &Path,
    ) -> AppResult<()> {
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

    pub async fn fit_segment_duration(
        &self,
        input: &Path,
        output: &Path,
        target_secs: f64,
    ) -> AppResult<()> {
        if !target_secs.is_finite() || target_secs <= 0.0 {
            return Err(AppError::Workflow(format!(
                "segment target duration is invalid: {target_secs}"
            )));
        }
        let source_secs = self.probe_duration(input).await?;
        let ffmpeg = self.ffmpeg_path().await?;
        let mut args = vec!["-y".to_string(), "-i".to_string(), path_arg(input)];
        let pad = target_secs - source_secs;
        if pad > 0.05 {
            args.push("-vf".to_string());
            args.push(format!("tpad=stop_mode=clone:stop_duration={pad:.3}"));
        }
        args.extend([
            "-t".to_string(),
            format!("{target_secs:.3}"),
            "-an".to_string(),
            "-c:v".to_string(),
            "libx264".to_string(),
            "-crf".to_string(),
            "18".to_string(),
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
            path_arg(output),
        ]);
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
        Err(AppError::Workflow(
            "ffmpeg segment duration fit failed".into(),
        ))
    }

    pub async fn is_video_black(&self, path: &Path) -> AppResult<bool> {
        let total_secs = self.probe_duration(path).await?;
        if total_secs <= 0.0 {
            return Ok(true);
        }
        let ffmpeg = self.ffmpeg_path().await?;
        let output = Command::new(&ffmpeg)
            .args([
                "-i",
                &path_arg(path),
                "-vf",
                "blackdetect=d=0.1:pix_th=0.05",
                "-an",
                "-f",
                "null",
                "-",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(AppError::from)?;
        if !output.status.success() {
            return Err(AppError::Workflow("ffmpeg black-frame probe failed".into()));
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        let black_secs: f64 = stderr
            .split("black_duration:")
            .skip(1)
            .filter_map(|rest| {
                rest.split_whitespace()
                    .next()
                    .and_then(|value| value.parse::<f64>().ok())
            })
            .sum();
        Ok(black_secs / total_secs >= 0.95)
    }

    pub async fn is_audio_silent(&self, path: &Path) -> AppResult<bool> {
        let ffmpeg = self.ffmpeg_path().await?;
        let output = Command::new(&ffmpeg)
            .args([
                "-i",
                &path_arg(path),
                "-af",
                "volumedetect",
                "-vn",
                "-f",
                "null",
                "-",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(AppError::from)?;
        if !output.status.success() {
            return Err(AppError::Workflow("ffmpeg volume probe failed".into()));
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        let mean_volume = stderr.split("mean_volume:").nth(1).and_then(|rest| {
            rest.split_whitespace()
                .next()
                .and_then(|value| value.parse::<f64>().ok())
        });
        Ok(mean_volume.is_none_or(|db| db < -55.0))
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

    pub async fn probe_video_size(&self, path: &Path) -> AppResult<(i32, i32)> {
        let ffprobe = self.ffprobe_path().await?;
        let output = Command::new(&ffprobe)
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height",
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
                "ffprobe size probe failed: {}",
                stderr.trim()
            )));
        }
        let parsed: serde_json::Value = serde_json::from_slice(&output.stdout)?;
        let stream = parsed
            .get("streams")
            .and_then(|value| value.as_array())
            .and_then(|streams| streams.first())
            .ok_or_else(|| AppError::Workflow("ffprobe returned no video stream".into()))?;
        let width = stream
            .get("width")
            .and_then(|value| value.as_i64())
            .filter(|value| *value > 0)
            .ok_or_else(|| AppError::Workflow("ffprobe returned no video width".into()))?
            as i32;
        let height = stream
            .get("height")
            .and_then(|value| value.as_i64())
            .filter(|value| *value > 0)
            .ok_or_else(|| AppError::Workflow("ffprobe returned no video height".into()))?
            as i32;
        Ok((width, height))
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
        Err(AppError::Workflow(
            "ffmpeg keyframe extraction failed".into(),
        ))
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
                vf_parts.push(format!(
                    "tpad=stop_mode=clone:stop_duration={:.3}",
                    pad + 0.5
                ));
            }
        }
        if let Some(ass_path) = subtitle_ass {
            vf_parts.push(format!(
                "subtitles='{}'",
                escape_subtitles_filter_path(ass_path)
            ));
        }

        if !vf_parts.is_empty() {
            args.push("-vf".to_string());
            args.push(vf_parts.join(","));
            args.push("-c:v".to_string());
            args.push("libx264".to_string());
            args.push("-crf".to_string());
            args.push("18".to_string());
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
            .args([
                "-y",
                "-i",
                &path_arg(input),
                "-c",
                "copy",
                &path_arg(output),
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
    path.to_string_lossy()
        .replace('\\', "/")
        .replace(':', "\\:")
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

#[cfg(test)]
mod tests {
    use super::*;

    fn test_runner() -> FfmpegRunner {
        FfmpegRunner::new(Arc::new(RwLock::new(AppConfig {
            workspace_root: String::new(),
            ffmpeg_path: None,
            ffprobe_path: None,
            asr_model: None,
            mock_providers: true,
            whisper_bin: None,
            whisper_model_dir: None,
        })))
    }

    async fn write_sine_wav(ffmpeg: &Path, out: &Path, sample_rate: u32) {
        let status = Command::new(ffmpeg)
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                &format!("sine=frequency=440:duration=0.2:sample_rate={sample_rate}"),
                &path_arg(out),
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .expect("spawn ffmpeg");
        assert!(status.success(), "failed to generate test wav");
    }

    fn wav_sample_rate(bytes: &[u8]) -> u32 {
        let fmt_pos = bytes
            .windows(4)
            .position(|window| window == b"fmt ")
            .expect("wav has fmt chunk");
        u32::from_le_bytes(bytes[fmt_pos + 12..fmt_pos + 16].try_into().unwrap())
    }

    async fn write_test_video(ffmpeg: &Path, out: &Path, duration_secs: f64) {
        let status = Command::new(ffmpeg)
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                &format!("testsrc=duration={duration_secs}:size=320x240:rate=30"),
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                &path_arg(out),
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .expect("spawn ffmpeg");
        assert!(status.success(), "failed to generate test video");
    }

    #[tokio::test]
    async fn is_video_black_flags_black_video_only() {
        let runner = test_runner();
        let ffmpeg = runner.ffmpeg_path().await.expect("ffmpeg available");
        let dir = std::env::temp_dir().join(format!("repix-black-test-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&dir).await.unwrap();

        let black = dir.join("black.mp4");
        let status = Command::new(&ffmpeg)
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=black:duration=1:size=320x240:rate=30",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                &path_arg(&black),
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .expect("spawn ffmpeg");
        assert!(status.success());
        let normal = dir.join("normal.mp4");
        write_test_video(&ffmpeg, &normal, 1.0).await;

        assert!(runner.is_video_black(&black).await.unwrap());
        assert!(!runner.is_video_black(&normal).await.unwrap());
        let _ = tokio::fs::remove_dir_all(&dir).await;
    }

    #[tokio::test]
    async fn is_audio_silent_flags_silence_only() {
        let runner = test_runner();
        let ffmpeg = runner.ffmpeg_path().await.expect("ffmpeg available");
        let dir = std::env::temp_dir().join(format!("repix-silent-test-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&dir).await.unwrap();

        let silent = dir.join("silent.wav");
        let status = Command::new(&ffmpeg)
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "anullsrc=duration=0.5:sample_rate=24000",
                &path_arg(&silent),
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .expect("spawn ffmpeg");
        assert!(status.success());
        let voiced = dir.join("voiced.wav");
        write_sine_wav(&ffmpeg, &voiced, 24_000).await;

        assert!(runner.is_audio_silent(&silent).await.unwrap());
        assert!(!runner.is_audio_silent(&voiced).await.unwrap());
        let _ = tokio::fs::remove_dir_all(&dir).await;
    }

    #[tokio::test]
    async fn fit_segment_duration_pads_short_segment() {
        let runner = test_runner();
        let ffmpeg = runner.ffmpeg_path().await.expect("ffmpeg available");
        let dir = std::env::temp_dir().join(format!("repix-fit-test-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let input = dir.join("short.mp4");
        write_test_video(&ffmpeg, &input, 1.0).await;

        let output = dir.join("padded.mp4");
        runner
            .fit_segment_duration(&input, &output, 2.0)
            .await
            .expect("fit segment");

        let duration = runner.probe_duration(&output).await.unwrap();
        assert!(
            (duration - 2.0).abs() < 0.2,
            "expected ~2.0s, got {duration}"
        );
        let _ = tokio::fs::remove_dir_all(&dir).await;
    }

    #[tokio::test]
    async fn fit_segment_duration_trims_long_segment() {
        let runner = test_runner();
        let ffmpeg = runner.ffmpeg_path().await.expect("ffmpeg available");
        let dir = std::env::temp_dir().join(format!("repix-fit-test-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let input = dir.join("long.mp4");
        write_test_video(&ffmpeg, &input, 2.0).await;

        let output = dir.join("trimmed.mp4");
        runner
            .fit_segment_duration(&input, &output, 1.0)
            .await
            .expect("fit segment");

        let duration = runner.probe_duration(&output).await.unwrap();
        assert!(
            (duration - 1.0).abs() < 0.2,
            "expected ~1.0s, got {duration}"
        );
        let _ = tokio::fs::remove_dir_all(&dir).await;
    }

    #[tokio::test]
    async fn concat_audio_preserves_native_sample_rate() {
        let runner = test_runner();
        let ffmpeg = runner.ffmpeg_path().await.expect("ffmpeg available");
        let dir = std::env::temp_dir().join(format!("repix-ffmpeg-test-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&dir).await.unwrap();

        let first = dir.join("a.wav");
        let second = dir.join("b.wav");
        write_sine_wav(&ffmpeg, &first, 24_000).await;
        write_sine_wav(&ffmpeg, &second, 24_000).await;

        let out = dir.join("narration.wav");
        runner
            .concat_audio(&[first, second], &out)
            .await
            .expect("concat audio");

        let bytes = tokio::fs::read(&out).await.unwrap();
        assert_eq!(wav_sample_rate(&bytes), 24_000);
        let _ = tokio::fs::remove_dir_all(&dir).await;
    }

    #[tokio::test]
    async fn concat_audio_single_input_preserves_native_sample_rate() {
        let runner = test_runner();
        let ffmpeg = runner.ffmpeg_path().await.expect("ffmpeg available");
        let dir = std::env::temp_dir().join(format!("repix-ffmpeg-test-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&dir).await.unwrap();

        let only = dir.join("a.wav");
        write_sine_wav(&ffmpeg, &only, 24_000).await;

        let out = dir.join("narration.wav");
        runner
            .concat_audio(&[only], &out)
            .await
            .expect("concat audio");

        let bytes = tokio::fs::read(&out).await.unwrap();
        assert_eq!(wav_sample_rate(&bytes), 24_000);
        let _ = tokio::fs::remove_dir_all(&dir).await;
    }
}
