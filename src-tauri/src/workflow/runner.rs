use std::sync::Arc;

use chrono::Utc;
use serde_json::json;
use tauri::AppHandle;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::config::AppConfig;
use crate::db::Repository;
use crate::errors::{AppError, AppResult};
use crate::media::ffmpeg::FfmpegRunner;
use crate::media::subtitles::segments_to_json;
use crate::media::whisper::WhisperRunner;
use crate::models::{AssetType, Scene, StageType, Task, TaskStatus};
use crate::storage::local_assets::{asset_for_path, mock_transcript_segments, AssetManager};
use crate::workspace::Workspace;
use crate::workflow::events::{emit_pipeline_event, PipelineEvent};
use crate::workflow::stages::{ordered_stages, stage_event_name};

#[derive(Debug, Clone)]
pub struct PipelineRunner {
    repo: Arc<Repository>,
    assets: Arc<AssetManager>,
    ffmpeg: Arc<FfmpegRunner>,
    whisper: Arc<WhisperRunner>,
    config: Arc<RwLock<AppConfig>>,
    workspace: Workspace,
}

impl PipelineRunner {
    pub fn new(
        repo: Arc<Repository>,
        assets: Arc<AssetManager>,
        ffmpeg: Arc<FfmpegRunner>,
        whisper: Arc<WhisperRunner>,
        config: Arc<RwLock<AppConfig>>,
    ) -> Self {
        Self {
            workspace: assets.workspace().clone(),
            repo,
            assets,
            ffmpeg,
            whisper,
            config,
        }
    }

    pub async fn run(&self, task_id: &str, run_id: &str, app: &AppHandle) -> AppResult<()> {
        let mock = self.config.read().await.mock_providers;
        self.run_pipeline(task_id, run_id, app, mock).await
    }

    async fn run_pipeline(
        &self,
        task_id: &str,
        run_id: &str,
        app: &AppHandle,
        mock: bool,
    ) -> AppResult<()> {
        let task = self
            .repo
            .get_task(task_id)
            .await?
            .ok_or_else(|| AppError::Workflow(format!("task not found: {task_id}")))?;
        let scene_count = scene_count_from_config(&task.config_json);
        let source_video = self.assets.find_source_video(task_id).await?;

        for stage in ordered_stages() {
            if self.is_canceled(task_id).await? {
                return Ok(());
            }
            let result = self
                .execute_stage(
                    task_id,
                    run_id,
                    app,
                    &stage,
                    &task,
                    scene_count,
                    &source_video,
                    mock,
                )
                .await;
            if let Err(error) = result {
                self.fail_pipeline(task_id, run_id, stage, &error.to_string(), app)
                    .await?;
                return Err(error);
            }
        }

        self.repo.complete_run(run_id, task_id).await?;
        self.log(task_id, run_id, app, "info", "workflow completed")
            .await?;
        emit_pipeline_event(
            app,
            PipelineEvent::Run {
                run_id: run_id.to_string(),
                task_id: task_id.to_string(),
                status: "COMPLETED".to_string(),
            },
        );
        Ok(())
    }

    async fn execute_stage(
        &self,
        task_id: &str,
        run_id: &str,
        app: &AppHandle,
        stage: &StageType,
        task: &Task,
        scene_count: i32,
        source_video: &std::path::Path,
        mock: bool,
    ) -> AppResult<()> {
        if mock {
            return match stage {
                StageType::TranscriptExtraction => {
                    self.mock_transcript_stage(task_id, run_id, app).await
                }
                StageType::ScriptRewrite => {
                    self.mock_rewrite_stage(task_id, run_id, app, task, scene_count)
                        .await
                }
                StageType::StoryboardGeneration => {
                    self.mock_storyboard_stage(task_id, run_id, app, scene_count)
                        .await
                }
                StageType::SegmentGeneration => {
                    self.mock_segment_stage(task_id, run_id, app, scene_count, source_video)
                        .await
                }
                StageType::FinalRender => {
                    self.mock_render_stage(task_id, run_id, app, source_video)
                        .await
                }
            };
        }

        match stage {
            StageType::TranscriptExtraction => {
                self.real_transcript_stage(task_id, run_id, app, task, source_video)
                    .await
            }
            _ => Err(AppError::Workflow(format!(
                "{} is not implemented yet (coming in PR8+)",
                stage_event_name(stage)
            ))),
        }
    }

    async fn real_transcript_stage(
        &self,
        task_id: &str,
        run_id: &str,
        app: &AppHandle,
        task: &Task,
        source_video: &std::path::Path,
    ) -> AppResult<()> {
        self.begin_stage(run_id, &StageType::TranscriptExtraction, app)
            .await?;
        self.log(task_id, run_id, app, "info", "Extracting audio track")
            .await?;

        let audio_path = self.assets.audio_path(task_id);
        self.ffmpeg
            .extract_audio(source_video, &audio_path)
            .await?;
        let audio = asset_for_path(
            task_id,
            run_id,
            AssetType::Audio,
            audio_path.clone(),
            "audio/wav",
            None,
        );
        self.repo.insert_asset(&audio).await?;

        self.log(task_id, run_id, app, "info", "Transcribing with whisper.cpp")
            .await?;
        let language = task
            .config_json
            .get("language")
            .and_then(|value| value.as_str());
        let output_prefix = self
            .workspace
            .root()
            .join("temp")
            .join(format!("{task_id}-{run_id}-whisper"));
        let transcript = self
            .whisper
            .transcribe(&audio_path, language, &output_prefix)
            .await?;

        let subtitle_path = self.assets.subtitle_path(task_id);
        let segments = segments_to_json(&transcript.segments);
        self.assets
            .write_subtitle_json(&subtitle_path, &segments)
            .await?;
        let subtitle = asset_for_path(
            task_id,
            run_id,
            AssetType::Subtitle,
            subtitle_path,
            "application/json",
            None,
        );
        self.repo.insert_asset(&subtitle).await?;

        let duration_secs = transcript
            .segments
            .last()
            .map(|segment| segment.end_ms as f64 / 1000.0)
            .unwrap_or(0.0);
        self.record_usage(
            "ASR",
            task_id,
            run_id,
            "transcribe",
            "seconds",
            duration_secs,
        )
        .await?;
        self.log(
            task_id,
            run_id,
            app,
            "info",
            &format!(
                "Transcript ready ({} segments, language={})",
                transcript.segments.len(),
                transcript.language
            ),
        )
        .await?;

        self.complete_stage(run_id, &StageType::TranscriptExtraction, app)
            .await
    }

    async fn mock_transcript_stage(
        &self,
        task_id: &str,
        run_id: &str,
        app: &AppHandle,
    ) -> AppResult<()> {
        self.begin_stage(run_id, &StageType::TranscriptExtraction, app)
            .await?;
        self.log(task_id, run_id, app, "info", "Extracting transcript and audio (mock)")
            .await?;

        let audio_path = self.assets.audio_path(task_id);
        self.assets.write_mock_wav(&audio_path).await?;
        let audio = asset_for_path(
            task_id,
            run_id,
            AssetType::Audio,
            audio_path,
            "audio/wav",
            None,
        );
        self.repo.insert_asset(&audio).await?;

        let subtitle_path = self.assets.subtitle_path(task_id);
        let segments = mock_transcript_segments();
        self.assets
            .write_subtitle_json(&subtitle_path, &segments)
            .await?;
        let subtitle = asset_for_path(
            task_id,
            run_id,
            AssetType::Subtitle,
            subtitle_path,
            "application/json",
            None,
        );
        self.repo.insert_asset(&subtitle).await?;
        self.record_usage("ASR", task_id, run_id, "transcribe", "seconds", 15.0)
            .await?;

        self.complete_stage(run_id, &StageType::TranscriptExtraction, app)
            .await
    }

    async fn mock_rewrite_stage(
        &self,
        task_id: &str,
        run_id: &str,
        app: &AppHandle,
        task: &Task,
        scene_count: i32,
    ) -> AppResult<()> {
        self.begin_stage(run_id, &StageType::ScriptRewrite, app)
            .await?;
        self.log(
            task_id,
            run_id,
            app,
            "info",
            &format!("Analyzing video sequence ({scene_count} frames) with Qwen-VL"),
        )
        .await?;

        let mut visual_descriptions = Vec::with_capacity(scene_count as usize);
        for index in 0..scene_count {
            let keyframe_path = self.assets.keyframe_path(task_id, index);
            self.assets.write_minimal_png(&keyframe_path).await?;
            let keyframe = asset_for_path(
                task_id,
                run_id,
                AssetType::Keyframe,
                keyframe_path,
                "image/png",
                Some(index),
            );
            self.repo.insert_asset(&keyframe).await?;
            visual_descriptions.push(format!(
                "Frame {index}: person in indoor setting, medium shot, \
                 natural lighting from window on left, neutral color palette, \
                 modern minimalist background with desk and plants"
            ));
        }
        self.record_usage(
            "QWEN_VL",
            task_id,
            run_id,
            "analyze_frames",
            "images",
            scene_count as f64,
        )
        .await?;

        let tone = task
            .config_json
            .get("rewriteTone")
            .and_then(|value| value.as_str())
            .unwrap_or("faithful");
        self.log(task_id, run_id, app, "info", "Rewriting script with visual context")
            .await?;
        for index in 0..scene_count {
            let visual = visual_descriptions
                .get(index as usize)
                .cloned()
                .unwrap_or_else(|| "default scene".to_string());
            let scene = Scene {
                id: Uuid::new_v4().to_string(),
                task_id: task_id.to_string(),
                run_id: Some(run_id.to_string()),
                scene_index: index,
                script_text: format!(
                    "[{tone}] Rewritten scene {} based on the source narration.",
                    index + 1
                ),
                visual_prompt: Some(format!("Enhanced: {visual}")),
                motion_prompt: Some("slow zoom in".to_string()),
                metadata_json: Some(json!({
                    "keyframeIndex": index,
                    "startMs": index * 3000,
                    "endMs": (index + 1) * 3000,
                })),
                created_at: Utc::now(),
            };
            self.repo.insert_scene(&scene).await?;
        }
        self.record_usage(
            "DEEPSEEK",
            task_id,
            run_id,
            "chat/completions",
            "tokens",
            scene_count as f64 * 150.0,
        )
        .await?;

        self.complete_stage(run_id, &StageType::ScriptRewrite, app)
            .await
    }

    async fn mock_storyboard_stage(
        &self,
        task_id: &str,
        run_id: &str,
        app: &AppHandle,
        scene_count: i32,
    ) -> AppResult<()> {
        self.begin_stage(run_id, &StageType::StoryboardGeneration, app)
            .await?;
        for index in 0..scene_count {
            let keyframe = self.assets.keyframe_path(task_id, index);
            let frame_path = self.assets.frame_path(task_id, index);
            self.assets.copy_file(&keyframe, &frame_path).await?;
            let frame = asset_for_path(
                task_id,
                run_id,
                AssetType::GeneratedFrame,
                frame_path,
                "image/png",
                Some(index),
            );
            self.repo.insert_asset(&frame).await?;
            self.log(
                task_id,
                run_id,
                app,
                "info",
                &format!("Scene {index}: storyboard frame generated"),
            )
            .await?;
            self.record_usage(
                "TONGYI",
                task_id,
                run_id,
                "image2image/image-synthesis",
                "images",
                1.0,
            )
            .await?;
        }
        self.complete_stage(run_id, &StageType::StoryboardGeneration, app)
            .await
    }

    async fn mock_segment_stage(
        &self,
        task_id: &str,
        run_id: &str,
        app: &AppHandle,
        scene_count: i32,
        source_video: &std::path::Path,
    ) -> AppResult<()> {
        self.begin_stage(run_id, &StageType::SegmentGeneration, app)
            .await?;
        for index in 0..scene_count {
            let segment_path = self.assets.segment_path(task_id, index);
            self.assets.copy_file(source_video, &segment_path).await?;
            let segment = asset_for_path(
                task_id,
                run_id,
                AssetType::VideoSegment,
                segment_path,
                "video/mp4",
                Some(index),
            );
            self.repo.insert_asset(&segment).await?;
            self.log(
                task_id,
                run_id,
                app,
                "info",
                &format!("Scene {index}: video segment ready"),
            )
            .await?;
            self.record_usage(
                "SEEDANCE",
                task_id,
                run_id,
                "submit_segment",
                "seconds",
                5.0,
            )
            .await?;
        }
        self.complete_stage(run_id, &StageType::SegmentGeneration, app)
            .await
    }

    async fn mock_render_stage(
        &self,
        task_id: &str,
        run_id: &str,
        app: &AppHandle,
        source_video: &std::path::Path,
    ) -> AppResult<()> {
        self.begin_stage(run_id, &StageType::FinalRender, app).await?;
        self.log(task_id, run_id, app, "info", "Rendering final video (mock)")
            .await?;
        let final_path = self.assets.final_path(task_id);
        self.assets.copy_file(source_video, &final_path).await?;
        let final_video = asset_for_path(
            task_id,
            run_id,
            AssetType::FinalVideo,
            final_path,
            "video/mp4",
            None,
        );
        self.repo.insert_asset(&final_video).await?;
        self.complete_stage(run_id, &StageType::FinalRender, app)
            .await
    }

    async fn begin_stage(
        &self,
        run_id: &str,
        stage: &StageType,
        app: &AppHandle,
    ) -> AppResult<()> {
        self.repo.start_stage(run_id, stage.clone()).await?;
        emit_pipeline_event(
            app,
            PipelineEvent::Stage {
                run_id: run_id.to_string(),
                stage: stage_event_name(stage),
                status: "RUNNING".to_string(),
            },
        );
        Ok(())
    }

    async fn complete_stage(
        &self,
        run_id: &str,
        stage: &StageType,
        app: &AppHandle,
    ) -> AppResult<()> {
        self.repo.complete_stage(run_id, stage.clone()).await?;
        emit_pipeline_event(
            app,
            PipelineEvent::Stage {
                run_id: run_id.to_string(),
                stage: stage_event_name(stage),
                status: "COMPLETED".to_string(),
            },
        );
        Ok(())
    }

    async fn fail_pipeline(
        &self,
        task_id: &str,
        run_id: &str,
        stage: StageType,
        error: &str,
        app: &AppHandle,
    ) -> AppResult<()> {
        self.repo.fail_run(run_id, stage.clone(), error).await?;
        self.repo
            .update_task_status(task_id, TaskStatus::Failed)
            .await?;
        self.log(task_id, run_id, app, "error", error).await?;
        emit_pipeline_event(
            app,
            PipelineEvent::Stage {
                run_id: run_id.to_string(),
                stage: stage_event_name(&stage),
                status: "FAILED".to_string(),
            },
        );
        emit_pipeline_event(
            app,
            PipelineEvent::Run {
                run_id: run_id.to_string(),
                task_id: task_id.to_string(),
                status: "FAILED".to_string(),
            },
        );
        emit_pipeline_event(
            app,
            PipelineEvent::Log {
                run_id: run_id.to_string(),
                task_id: Some(task_id.to_string()),
                level: "ERROR".to_string(),
                message: error.to_string(),
            },
        );
        Ok(())
    }

    async fn log(
        &self,
        task_id: &str,
        run_id: &str,
        app: &AppHandle,
        level: &str,
        message: &str,
    ) -> AppResult<()> {
        self.repo
            .insert_log(Some(task_id), Some(run_id), level, message)
            .await?;
        emit_pipeline_event(
            app,
            PipelineEvent::Log {
                run_id: run_id.to_string(),
                task_id: Some(task_id.to_string()),
                level: level.to_uppercase(),
                message: message.to_string(),
            },
        );
        Ok(())
    }

    async fn record_usage(
        &self,
        provider: &str,
        task_id: &str,
        run_id: &str,
        endpoint: &str,
        unit: &str,
        quantity: f64,
    ) -> AppResult<()> {
        self.repo
            .insert_api_usage_log(
                provider,
                Some(task_id),
                Some(run_id),
                endpoint,
                unit,
                quantity,
                Some(0.0),
                true,
            )
            .await
    }

    async fn is_canceled(&self, task_id: &str) -> AppResult<bool> {
        let task = self
            .repo
            .get_task(task_id)
            .await?
            .ok_or_else(|| AppError::Workflow(format!("task not found: {task_id}")))?;
        Ok(matches!(task.status, TaskStatus::Canceled))
    }
}

fn scene_count_from_config(config: &serde_json::Value) -> i32 {
    config
        .get("sceneCount")
        .and_then(|value| value.as_i64())
        .unwrap_or(5)
        .clamp(1, 20) as i32
}