use std::path::{Path, PathBuf};

use crate::errors::{AppError, AppResult};
use crate::media::ffmpeg::FfmpegRunner;

pub const DEFAULT_SUBTITLE_REGION_RATIO: f64 = 0.18;
pub const MIN_SUBTITLE_REGION_RATIO: f64 = 0.08;
pub const MAX_SUBTITLE_REGION_RATIO: f64 = 0.30;

#[derive(Debug, Clone, Copy)]
pub struct KeyframeOptions {
    pub subtitle_region_ratio: Option<f64>,
}

pub async fn extract_keyframes(
    ffmpeg: &FfmpegRunner,
    video_path: &Path,
    output_dir: &Path,
    count: i32,
    options: KeyframeOptions,
) -> AppResult<Vec<PathBuf>> {
    if count < 1 {
        return Err(AppError::Workflow(format!(
            "keyframe count must be >= 1, got {count}"
        )));
    }
    tokio::fs::create_dir_all(output_dir).await?;
    let duration = ffmpeg.probe_duration(video_path).await?;
    if duration <= 0.0 {
        return Err(AppError::Workflow(format!(
            "video has zero or negative duration: {duration}"
        )));
    }
    let fps = count as f64 / duration;
    let filter = frame_filter(fps, options.subtitle_region_ratio)?;
    let output_pattern = output_dir.join("frame_%03d.png");
    ffmpeg
        .extract_frames(video_path, &output_pattern, &filter)
        .await?;
    let mut frames = collect_frame_paths(output_dir, count)?;
    pad_keyframes_to_count(&mut frames, output_dir, count).await?;
    Ok(frames)
}

pub async fn pad_keyframes_to_count(
    frame_paths: &mut Vec<PathBuf>,
    output_dir: &Path,
    count: i32,
) -> AppResult<()> {
    if frame_paths.is_empty() {
        return Err(AppError::Workflow("no keyframes extracted from source video".into()));
    }
    if frame_paths.len() < count as usize {
        tracing::info!(
            extracted = frame_paths.len(),
            requested = count,
            "video shorter than scene count; duplicating last keyframe for missing scenes"
        );
    }
    while frame_paths.len() < count as usize {
        let last = frame_paths
            .last()
            .expect("frame_paths is non-empty")
            .clone();
        let next_index = frame_paths.len() + 1;
        let padded = output_dir.join(format!("frame_{next_index:03}.png"));
        tokio::fs::copy(&last, &padded).await?;
        frame_paths.push(padded);
    }
    Ok(())
}

fn frame_filter(fps: f64, subtitle_region_ratio: Option<f64>) -> AppResult<String> {
    let Some(ratio) = subtitle_region_ratio else {
        return Ok(format!("fps={fps}"));
    };
    if ratio < MIN_SUBTITLE_REGION_RATIO || ratio > MAX_SUBTITLE_REGION_RATIO {
        return Err(AppError::Workflow(format!(
            "subtitle_region_ratio must be between {MIN_SUBTITLE_REGION_RATIO} and {MAX_SUBTITLE_REGION_RATIO}, got {ratio}"
        )));
    }
    Ok(format!(
        "fps={fps},split[base][blur];[blur]crop=w=iw:h=ih*{ratio:.3}:x=0:y=ih-ih*{ratio:.3},boxblur=10:1[blurred];[base][blurred]overlay=0:H-h"
    ))
}

fn collect_frame_paths(output_dir: &Path, count: i32) -> AppResult<Vec<PathBuf>> {
    let mut frames = Vec::new();
    for index in 1..=count {
        let path = output_dir.join(format!("frame_{index:03}.png"));
        if path.exists() {
            frames.push(path);
        }
    }
    if frames.is_empty() {
        return Err(AppError::Workflow(format!(
            "ffmpeg produced no keyframes in {}",
            output_dir.display()
        )));
    }
    if frames.len() < count as usize && frames.len() + 1 < count as usize {
        return Err(AppError::Workflow(format!(
            "expected {count} keyframes, got {}",
            frames.len()
        )));
    }
    Ok(frames.into_iter().take(count as usize).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn pad_keyframes_duplicates_last_frame() {
        let dir = std::env::temp_dir().join(format!("repix-pad-test-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&dir).await.expect("create temp dir");
        let frame_001 = dir.join("frame_001.png");
        tokio::fs::write(&frame_001, b"png").await.expect("write frame");

        let mut frames = vec![frame_001.clone()];
        pad_keyframes_to_count(&mut frames, &dir, 3)
            .await
            .expect("pad keyframes");

        assert_eq!(frames.len(), 3);
        assert!(dir.join("frame_002.png").exists());
        assert!(dir.join("frame_003.png").exists());
        let _ = tokio::fs::remove_dir_all(&dir).await;
    }
}