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
        return Err(AppError::Workflow(
            "no keyframes extracted from source video".into(),
        ));
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

const CANDIDATE_FRAMES_PER_SCENE: i32 = 5;

fn frame_filter(fps: f64, subtitle_region_ratio: Option<f64>) -> AppResult<String> {
    let candidate_fps = fps * CANDIDATE_FRAMES_PER_SCENE as f64;
    let select = format!("fps={candidate_fps},thumbnail={CANDIDATE_FRAMES_PER_SCENE}");
    let Some(ratio) = subtitle_region_ratio else {
        return Ok(select);
    };
    if ratio < MIN_SUBTITLE_REGION_RATIO || ratio > MAX_SUBTITLE_REGION_RATIO {
        return Err(AppError::Workflow(format!(
            "subtitle_region_ratio must be between {MIN_SUBTITLE_REGION_RATIO} and {MAX_SUBTITLE_REGION_RATIO}, got {ratio}"
        )));
    }
    Ok(format!(
        "{select},split[base][blur];[blur]crop=w=iw:h=ih*{ratio:.3}:x=0:y=ih-ih*{ratio:.3},boxblur=10:1[blurred];[base][blurred]overlay=0:H-h"
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

    #[test]
    fn frame_filter_picks_representative_frame_among_candidates() {
        assert_eq!(frame_filter(0.5, None).unwrap(), "fps=2.5,thumbnail=5");
        let with_blur = frame_filter(0.5, Some(0.18)).unwrap();
        assert!(
            with_blur.starts_with("fps=2.5,thumbnail=5,"),
            "blur chain must run after representative-frame selection: {with_blur}"
        );
    }

    #[tokio::test]
    async fn extract_keyframes_yields_sequential_one_based_frames() {
        use crate::config::AppConfig;
        use std::sync::Arc;
        use tokio::sync::RwLock;

        let ffmpeg = FfmpegRunner::new(Arc::new(RwLock::new(AppConfig {
            workspace_root: String::new(),
            ffmpeg_path: None,
            ffprobe_path: None,
            asr_model: None,
            mock_providers: true,
            whisper_bin: None,
            whisper_model_dir: None,
        })));
        let dir = std::env::temp_dir().join(format!("repix-kf-test-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let video = dir.join("src.mp4");
        let status = tokio::process::Command::new("ffmpeg")
            .args([
                "-y",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc=duration=2:size=320x240:rate=30",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                &video.to_string_lossy(),
            ])
            .status()
            .await
            .expect("spawn ffmpeg");
        assert!(status.success(), "failed to generate test video");

        let out_dir = dir.join("keyframes");
        let frames = extract_keyframes(
            &ffmpeg,
            &video,
            &out_dir,
            3,
            KeyframeOptions {
                subtitle_region_ratio: None,
            },
        )
        .await
        .expect("extract keyframes");

        assert_eq!(frames.len(), 3);
        for index in 1..=3 {
            assert!(out_dir.join(format!("frame_{index:03}.png")).exists());
        }
        assert!(
            !out_dir.join("frame_000.png").exists(),
            "keyframes must be numbered from 1 without a dropped zeroth frame"
        );
        let _ = tokio::fs::remove_dir_all(&dir).await;
    }

    #[tokio::test]
    async fn pad_keyframes_duplicates_last_frame() {
        let dir = std::env::temp_dir().join(format!("repix-pad-test-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&dir)
            .await
            .expect("create temp dir");
        let frame_001 = dir.join("frame_001.png");
        tokio::fs::write(&frame_001, b"png")
            .await
            .expect("write frame");

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
