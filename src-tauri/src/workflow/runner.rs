use std::sync::Arc;

use chrono::Utc;
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::config::AppConfig;
use crate::db::Repository;
use crate::errors::{AppError, AppResult};
use crate::media::ffmpeg::FfmpegRunner;
use crate::media::frames::{extract_keyframes, KeyframeOptions, DEFAULT_SUBTITLE_REGION_RATIO};
use crate::media::subtitles::{
    ass_style_from_config, build_ass, cues_from_scenes_with_tts, read_segments_from_json,
    segments_to_json, transcript_text,
};
use crate::media::whisper::WhisperRunner;
use crate::models::{AssetType, Scene, StageType, Task, TaskStatus, WorkflowTaskType};
use crate::providers::cosyvoice::CosyVoiceClient;
use crate::providers::deepseek::{DeepSeekClient, DeepSeekUsage};
use crate::providers::fetch::download_to_file;
use crate::providers::http_client::is_transient_provider_error;
use crate::providers::qwen_vl::QwenVlClient;
use crate::providers::seedance::{SeedanceClient, SegmentPollStatus};
use crate::providers::tongyi::TongyiClient;
use crate::storage::local_assets::{asset_for_path, mock_transcript_segments, AssetManager};

use crate::workflow::events::{emit_pipeline_event, PipelineEvent};
use crate::workflow::stages::{ordered_stages, stage_event_name};
use crate::workspace::Workspace;

#[derive(Debug, Clone)]
pub struct PipelineRunner {
    repo: Arc<Repository>,
    assets: Arc<AssetManager>,
    ffmpeg: Arc<FfmpegRunner>,
    whisper: Arc<WhisperRunner>,
    config: Arc<RwLock<AppConfig>>,
    workspace: Workspace,
}

#[derive(Debug, Clone, Copy)]
struct UsageLog<'a> {
    provider: &'a str,
    endpoint: &'a str,
    unit: &'a str,
    quantity: f64,
    cost_usd: Option<f64>,
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
        let task_type = task.task_type;
        let scene_count = scene_count_from_config(&task.config_json, task_type);
        let source_video = if task_type == WorkflowTaskType::Replicate {
            Some(self.assets.find_source_video(task_id).await?)
        } else {
            None
        };

        for (order_index, stage) in ordered_stages(task_type).into_iter().enumerate() {
            if self.is_canceled(task_id).await? {
                self.cancel_pipeline(task_id, run_id, app).await?;
                return Ok(());
            }
            let result = self
                .execute_stage(
                    task_id,
                    run_id,
                    app,
                    &stage,
                    order_index as i32,
                    &task,
                    scene_count,
                    source_video.as_deref(),
                    mock,
                )
                .await;
            if let Err(error) = result {
                self.fail_pipeline(task_id, run_id, stage, &error.to_string(), app)
                    .await?;
                return Err(error);
            }
        }

        if self.settle_run_completion(task_id, run_id).await? {
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
        } else {
            self.log(task_id, run_id, app, "warn", "workflow canceled")
                .await?;
            emit_pipeline_event(
                app,
                PipelineEvent::Run {
                    run_id: run_id.to_string(),
                    task_id: task_id.to_string(),
                    status: "CANCELLED".to_string(),
                },
            );
        }
        Ok(())
    }

    async fn execute_stage(
        &self,
        task_id: &str,
        run_id: &str,
        app: &AppHandle,
        stage: &StageType,
        _order_index: i32,
        task: &Task,
        scene_count: i32,
        source_video: Option<&std::path::Path>,
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
                StageType::ScriptPlanning => {
                    self.mock_script_planning_stage(task_id, run_id, app, task, scene_count)
                        .await
                }
                StageType::StoryboardGeneration => {
                    self.mock_storyboard_stage(task_id, run_id, app, scene_count)
                        .await
                }
                StageType::TtsSynthesis => {
                    self.mock_tts_stage(task_id, run_id, app, scene_count).await
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
                let source_video = source_video.ok_or_else(|| {
                    AppError::Workflow("source video missing for replicate task".into())
                })?;
                self.real_transcript_stage(task_id, run_id, app, task, source_video)
                    .await
            }
            StageType::ScriptRewrite => {
                let source_video = source_video.ok_or_else(|| {
                    AppError::Workflow("source video missing for replicate task".into())
                })?;
                self.real_rewrite_stage(task_id, run_id, app, task, scene_count, source_video)
                    .await
            }
            StageType::ScriptPlanning => {
                self.real_script_planning_stage(task_id, run_id, app, task, scene_count)
                    .await
            }
            StageType::StoryboardGeneration => {
                self.real_storyboard_stage(task_id, run_id, app, task).await
            }
            StageType::TtsSynthesis => {
                self.real_tts_stage(task_id, run_id, app, task, scene_count)
                    .await
            }
            StageType::SegmentGeneration => {
                self.real_segment_stage(task_id, run_id, app, task, scene_count)
                    .await
            }
            StageType::FinalRender => {
                self.real_render_stage(task_id, run_id, app, task, scene_count)
                    .await
            }
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
        if transcript_outputs_ready(&self.assets, task_id) {
            self.log(
                task_id,
                run_id,
                app,
                "info",
                "Transcript and audio already exist; skipping",
            )
            .await?;
            return self
                .complete_stage(run_id, &StageType::TranscriptExtraction, app)
                .await;
        }
        self.log(task_id, run_id, app, "info", "Extracting audio track")
            .await?;

        let audio_path = self.assets.audio_path(task_id);
        self.ffmpeg.extract_audio(source_video, &audio_path).await?;
        let audio = asset_for_path(
            task_id,
            run_id,
            AssetType::Audio,
            audio_path.clone(),
            "audio/wav",
            None,
        );
        self.repo.insert_asset(&audio).await?;

        self.log(
            task_id,
            run_id,
            app,
            "info",
            "Transcribing with whisper.cpp",
        )
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
        self.whisper.ensure_model(&self.workspace).await?;
        let transcript = self
            .whisper
            .transcribe(&self.workspace, &audio_path, language, &output_prefix)
            .await?;

        let mut segments = transcript.segments;
        if should_correct_subtitles(&task.config_json) {
            self.log(
                task_id,
                run_id,
                app,
                "info",
                "Correcting subtitles with DeepSeek",
            )
            .await?;
            let deepseek = DeepSeekClient::new(self.repo.clone());
            let output = deepseek
                .correct_subtitles(&segments, &subtitle_target_language(&task.config_json))
                .await?;
            segments = output.value;
            self.record_deepseek_usage(task_id, run_id, output.usage)
                .await?;
        }

        let segment_count = segments.len();
        let duration_secs = segments
            .last()
            .map(|segment| segment.end_ms as f64 / 1000.0)
            .unwrap_or(0.0);

        let subtitle_path = self.assets.subtitle_path(task_id);
        let subtitle_json = segments_to_json(&segments);
        self.assets
            .write_subtitle_json(&subtitle_path, &subtitle_json)
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
        self.record_usage(
            task_id,
            run_id,
            UsageLog {
                provider: "ASR",
                endpoint: "transcribe",
                unit: "seconds",
                quantity: duration_secs,
                cost_usd: Some(0.0),
            },
        )
        .await?;
        self.log(
            task_id,
            run_id,
            app,
            "info",
            &format!(
                "Transcript ready ({segment_count} segments, language={})",
                transcript.language
            ),
        )
        .await?;

        self.complete_stage(run_id, &StageType::TranscriptExtraction, app)
            .await
    }

    async fn real_rewrite_stage(
        &self,
        task_id: &str,
        run_id: &str,
        app: &AppHandle,
        task: &Task,
        scene_count: i32,
        source_video: &std::path::Path,
    ) -> AppResult<()> {
        self.begin_stage(run_id, &StageType::ScriptRewrite, app)
            .await?;
        if rewrite_outputs_ready(&self.assets, task_id, scene_count).await? {
            self.log(
                task_id,
                run_id,
                app,
                "info",
                "Script rewrite outputs already exist; skipping",
            )
            .await?;
            return self
                .complete_stage(run_id, &StageType::ScriptRewrite, app)
                .await;
        }

        self.log(
            task_id,
            run_id,
            app,
            "info",
            &format!("Extracting {scene_count} keyframes from source video"),
        )
        .await?;
        let keyframe_dir = self.workspace.task_dir(task_id).join("keyframes");
        let subtitle_region_ratio = keyframe_subtitle_region_ratio(&task.config_json)?;
        if subtitle_region_ratio.is_some() {
            self.log(
                task_id,
                run_id,
                app,
                "info",
                &format!(
                    "Blurring bottom {:.0}% subtitle region",
                    subtitle_region_ratio.unwrap_or(DEFAULT_SUBTITLE_REGION_RATIO) * 100.0
                ),
            )
            .await?;
        }
        let frame_paths = extract_keyframes(
            &self.ffmpeg,
            source_video,
            &keyframe_dir,
            scene_count,
            KeyframeOptions {
                subtitle_region_ratio,
            },
        )
        .await?;

        let mut keyframe_paths = Vec::with_capacity(frame_paths.len());
        for (index, frame_path) in frame_paths.iter().enumerate() {
            let keyframe = asset_for_path(
                task_id,
                run_id,
                AssetType::Keyframe,
                frame_path.clone(),
                "image/png",
                Some(index as i32),
            );
            self.repo.insert_asset(&keyframe).await?;
            keyframe_paths.push(frame_path.to_string_lossy().to_string());
            self.log(
                task_id,
                run_id,
                app,
                "info",
                &format!("Keyframe {index} extracted"),
            )
            .await?;
        }

        self.log(
            task_id,
            run_id,
            app,
            "info",
            &format!(
                "Analyzing video sequence ({} frames) with Qwen-VL",
                keyframe_paths.len()
            ),
        )
        .await?;
        let qwen = QwenVlClient::new(self.repo.clone());
        let analysis = qwen.analyze_video_frames(&frame_paths).await?;
        self.record_usage(
            task_id,
            run_id,
            UsageLog {
                provider: "QWEN_VL",
                endpoint: "multimodal-generation/generation",
                unit: "tokens",
                quantity: analysis.usage.total_tokens as f64,
                cost_usd: None,
            },
        )
        .await?;

        let subtitle_path = self.assets.subtitle_path(task_id);
        let segments = read_segments_from_json(&subtitle_path).await?;
        let transcript = transcript_text(&segments);
        let tone = task
            .config_json
            .get("rewriteTone")
            .and_then(|value| value.as_str())
            .unwrap_or("faithful");
        self.log(
            task_id,
            run_id,
            app,
            "info",
            "Rewriting script with visual context",
        )
        .await?;
        let deepseek = DeepSeekClient::new(self.repo.clone());
        let output = deepseek
            .rewrite_script_with_visuals(
                &transcript,
                &analysis.descriptions,
                &keyframe_paths,
                tone,
                scene_count,
            )
            .await?;
        self.record_deepseek_usage(task_id, run_id, output.usage)
            .await?;

        for scene in output.value {
            let metadata_json = Some(json!({
                "keyframePath": scene.keyframe_path,
                "startMs": scene.start_ms,
                "endMs": scene.end_ms,
            }));
            self.repo
                .insert_scene(&Scene {
                    id: Uuid::new_v4().to_string(),
                    task_id: task_id.to_string(),
                    run_id: Some(run_id.to_string()),
                    scene_index: scene.index,
                    script_text: scene.script_text,
                    visual_prompt: scene.visual_prompt,
                    motion_prompt: scene.motion_prompt,
                    metadata_json,
                    created_at: Utc::now(),
                })
                .await?;
        }

        self.complete_stage(run_id, &StageType::ScriptRewrite, app)
            .await
    }

    async fn real_storyboard_stage(
        &self,
        task_id: &str,
        run_id: &str,
        app: &AppHandle,
        task: &Task,
    ) -> AppResult<()> {
        self.begin_stage(run_id, &StageType::StoryboardGeneration, app)
            .await?;
        let tongyi = TongyiClient::new(self.repo.clone());
        let aspect_ratio = task
            .config_json
            .get("aspectRatio")
            .and_then(|value| value.as_str())
            .unwrap_or("16:9");
        let strength = img2img_strength_for_tone(
            task.config_json
                .get("rewriteTone")
                .and_then(|value| value.as_str())
                .unwrap_or("faithful"),
        );
        let scenes = self.scenes_for_run(task_id, run_id).await?;
        if scenes.is_empty() {
            return Err(AppError::Workflow(
                "no scenes found for storyboard generation".into(),
            ));
        }

        for scene in scenes {
            if self.is_canceled(task_id).await? {
                self.cancel_pipeline(task_id, run_id, app).await?;
                return Ok(());
            }
            let index = scene.scene_index;
            let frame_path = self.assets.frame_path(task_id, index);
            if frame_path.exists() {
                self.log(
                    task_id,
                    run_id,
                    app,
                    "info",
                    &format!("Scene {index}: storyboard frame already exists"),
                )
                .await?;
                continue;
            }
            let keyframe_path = scene_keyframe_path(&scene, task_id, &self.assets)?;
            let prompt = scene_storyboard_prompt(&scene);
            self.log(
                task_id,
                run_id,
                app,
                "info",
                &format!("Scene {index}: generating storyboard frame with Tongyi"),
            )
            .await?;
            let output = tongyi
                .generate_frame_img2img(&keyframe_path, &prompt, index, strength, aspect_ratio)
                .await?;
            download_to_file(&output.source_url, &frame_path).await?;
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
                task_id,
                run_id,
                UsageLog {
                    provider: "TONGYI",
                    endpoint: "image2image/image-synthesis",
                    unit: "images",
                    quantity: output.image_count as f64,
                    cost_usd: None,
                },
            )
            .await?;
        }

        self.complete_stage(run_id, &StageType::StoryboardGeneration, app)
            .await
    }

    async fn real_script_planning_stage(
        &self,
        task_id: &str,
        run_id: &str,
        app: &AppHandle,
        task: &Task,
        scene_count: i32,
    ) -> AppResult<()> {
        self.begin_stage(run_id, &StageType::ScriptPlanning, app)
            .await?;
        if script_planning_outputs_ready(&self.assets, task_id, scene_count).await? {
            self.log(
                task_id,
                run_id,
                app,
                "info",
                "Script planning outputs already exist; skipping",
            )
            .await?;
            return self
                .complete_stage(run_id, &StageType::ScriptPlanning, app)
                .await;
        }

        let requirements = requirements_from_config(&task.config_json)?;
        self.log(
            task_id,
            run_id,
            app,
            "info",
            &format!("Analyzing {scene_count} images with Qwen-VL"),
        )
        .await?;
        let mut image_paths = Vec::with_capacity(scene_count as usize);
        for index in 0..scene_count {
            let path = self.assets.source_image_path(task_id, index);
            if !path.exists() {
                return Err(AppError::Workflow(format!(
                    "source image missing for scene {index}"
                )));
            }
            image_paths.push(path);
        }
        let qwen = QwenVlClient::new(self.repo.clone());
        let analysis = qwen.analyze_video_frames(&image_paths).await?;
        self.record_usage(
            task_id,
            run_id,
            UsageLog {
                provider: "QWEN_VL",
                endpoint: "multimodal-generation/generation",
                unit: "tokens",
                quantity: analysis.usage.total_tokens as f64,
                cost_usd: None,
            },
        )
        .await?;

        let tone = task
            .config_json
            .get("rewriteTone")
            .and_then(|value| value.as_str())
            .unwrap_or("faithful");
        self.log(
            task_id,
            run_id,
            app,
            "info",
            "Planning script from images and brief",
        )
        .await?;
        let deepseek = DeepSeekClient::new(self.repo.clone());
        let output = deepseek
            .plan_script_from_images(&requirements, &analysis.descriptions, tone, scene_count)
            .await?;
        self.record_deepseek_usage(task_id, run_id, output.usage)
            .await?;

        for scene in output.value {
            let source_image = self.assets.source_image_path(task_id, scene.index);
            let frame_path = self.assets.frame_path(task_id, scene.index);
            self.assets.copy_file(&source_image, &frame_path).await?;
            let frame = asset_for_path(
                task_id,
                run_id,
                AssetType::GeneratedFrame,
                frame_path.clone(),
                "image/png",
                Some(scene.index),
            );
            self.repo.insert_asset(&frame).await?;
            let visual = analysis.descriptions.get(scene.index as usize).cloned();
            let metadata_json = Some(json!({
                "sourceImagePath": source_image.to_string_lossy(),
                "framePath": frame_path.to_string_lossy(),
            }));
            self.repo
                .insert_scene(&Scene {
                    id: Uuid::new_v4().to_string(),
                    task_id: task_id.to_string(),
                    run_id: Some(run_id.to_string()),
                    scene_index: scene.index,
                    script_text: scene.script_text,
                    visual_prompt: visual,
                    motion_prompt: scene.motion_prompt,
                    metadata_json,
                    created_at: Utc::now(),
                })
                .await?;
        }

        self.complete_stage(run_id, &StageType::ScriptPlanning, app)
            .await
    }

    async fn real_tts_stage(
        &self,
        task_id: &str,
        run_id: &str,
        app: &AppHandle,
        task: &Task,
        scene_count: i32,
    ) -> AppResult<()> {
        self.begin_stage(run_id, &StageType::TtsSynthesis, app)
            .await?;
        if tts_outputs_ready(&self.assets, task_id, scene_count) {
            self.log(
                task_id,
                run_id,
                app,
                "info",
                "TTS outputs already exist; skipping",
            )
            .await?;
            return self
                .complete_stage(run_id, &StageType::TtsSynthesis, app)
                .await;
        }

        let cosyvoice = CosyVoiceClient::new(self.repo.clone());
        let voice = task
            .config_json
            .get("voice")
            .and_then(|value| value.as_str())
            .unwrap_or("female-1");
        let language = task
            .config_json
            .get("language")
            .and_then(|value| value.as_str());
        let scenes = self.scenes_for_run(task_id, run_id).await?;
        if scenes.is_empty() {
            return Err(AppError::Workflow(
                "no scenes found for TTS synthesis".into(),
            ));
        }

        let mut segment_paths = Vec::with_capacity(scene_count as usize);
        for index in 0..scene_count {
            let scene = scenes
                .iter()
                .find(|scene| scene.scene_index == index)
                .ok_or_else(|| AppError::Workflow(format!("scene {index} not found")))?;
            let tts_path = self.assets.tts_segment_path(task_id, index);
            if tts_path.exists() {
                segment_paths.push(tts_path);
                continue;
            }
            self.log(
                task_id,
                run_id,
                app,
                "info",
                &format!("Scene {index}: synthesizing TTS with CosyVoice"),
            )
            .await?;
            let output = cosyvoice
                .synthesize_to_file(&scene.script_text, voice, language, &tts_path)
                .await?;
            if self.ffmpeg.is_audio_silent(&tts_path).await? {
                let _ = tokio::fs::remove_file(&tts_path).await;
                return Err(AppError::Workflow(format!(
                    "Scene {index}: TTS produced silent audio; resume the task to regenerate"
                )));
            }
            let duration_secs = self.ffmpeg.probe_duration(&tts_path).await?;
            let duration_ms = (duration_secs * 1000.0).round() as i64;
            let mut metadata = scene.metadata_json.clone().unwrap_or_else(|| json!({}));
            if let Some(object) = metadata.as_object_mut() {
                object.insert(
                    "ttsDurationMs".to_string(),
                    Value::Number(duration_ms.into()),
                );
            }
            self.repo
                .update_scene_metadata(&scene.id, &metadata)
                .await?;
            let tts_asset = asset_for_path(
                task_id,
                run_id,
                AssetType::TtsSegment,
                tts_path.clone(),
                "audio/wav",
                Some(index),
            );
            self.repo.insert_asset(&tts_asset).await?;
            segment_paths.push(tts_path);
            self.record_usage(
                task_id,
                run_id,
                UsageLog {
                    provider: "COSYVOICE",
                    endpoint: "audio/tts/SpeechSynthesizer",
                    unit: "characters",
                    quantity: output.characters as f64,
                    cost_usd: None,
                },
            )
            .await?;
        }

        let narration_path = self.assets.narration_path(task_id);
        self.log(task_id, run_id, app, "info", "Concatenating TTS segments")
            .await?;
        self.ffmpeg
            .concat_audio(&segment_paths, &narration_path)
            .await?;
        let narration = asset_for_path(
            task_id,
            run_id,
            AssetType::Audio,
            narration_path,
            "audio/wav",
            None,
        );
        self.repo.insert_asset(&narration).await?;

        self.complete_stage(run_id, &StageType::TtsSynthesis, app)
            .await
    }

    async fn real_segment_stage(
        &self,
        task_id: &str,
        run_id: &str,
        app: &AppHandle,
        task: &Task,
        scene_count: i32,
    ) -> AppResult<()> {
        self.begin_stage(run_id, &StageType::SegmentGeneration, app)
            .await?;
        let seedance = SeedanceClient::new(self.repo.clone());
        let resolution = resolution_from_config(&task.config_json);
        let scenes = self.scenes_for_run(task_id, run_id).await?;

        for index in 0..scene_count {
            if self.is_canceled(task_id).await? {
                self.cancel_pipeline(task_id, run_id, app).await?;
                return Ok(());
            }
            let scene = scenes
                .iter()
                .find(|scene| scene.scene_index == index)
                .ok_or_else(|| AppError::Workflow(format!("scene {index} not found")))?;
            let segment_path = self.assets.segment_path(task_id, index);
            if segment_path.exists() {
                self.log(
                    task_id,
                    run_id,
                    app,
                    "info",
                    &format!("Scene {index}: video segment already exists"),
                )
                .await?;
                continue;
            }
            let frame_path = self.assets.frame_path(task_id, index);
            if !frame_path.exists() {
                return Err(AppError::Workflow(format!(
                    "storyboard frame missing for scene {index}"
                )));
            }
            let motion = scene.motion_prompt.as_deref();
            let duration_sec = scene_duration_secs(scene);
            let job_id = if let Some(job_id) = scene_seedance_job_id(scene) {
                self.log(
                    task_id,
                    run_id,
                    app,
                    "info",
                    &format!("Scene {index}: resuming Seedance job {job_id}"),
                )
                .await?;
                job_id
            } else {
                self.log(
                    task_id,
                    run_id,
                    app,
                    "info",
                    &format!("Scene {index}: submitting video segment to Seedance"),
                )
                .await?;
                let job_id = seedance
                    .submit_segment(&frame_path, duration_sec, motion, resolution.as_deref())
                    .await?;
                let mut metadata = scene.metadata_json.clone().unwrap_or_else(|| json!({}));
                if let Some(object) = metadata.as_object_mut() {
                    object.insert("seedanceJobId".to_string(), Value::String(job_id.clone()));
                }
                self.repo
                    .update_scene_metadata(&scene.id, &metadata)
                    .await?;
                job_id
            };
            self.log(
                task_id,
                run_id,
                app,
                "info",
                &format!("Scene {index}: polling Seedance job {job_id}"),
            )
            .await?;
            let video_url = self
                .poll_segment_with_cancel(task_id, run_id, app, &seedance, &job_id, index)
                .await?;
            download_to_file(&video_url, &segment_path).await?;
            if self.ffmpeg.is_video_black(&segment_path).await? {
                let _ = tokio::fs::remove_file(&segment_path).await;
                let mut metadata = scene.metadata_json.clone().unwrap_or_else(|| json!({}));
                if let Some(object) = metadata.as_object_mut() {
                    object.remove("seedanceJobId");
                }
                self.repo
                    .update_scene_metadata(&scene.id, &metadata)
                    .await?;
                return Err(AppError::Workflow(format!(
                    "Scene {index}: generated segment is black; resume the task to regenerate"
                )));
            }
            let actual_duration_sec =
                generated_segment_usage_seconds(self.ffmpeg.probe_duration(&segment_path).await?)?;
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
                task_id,
                run_id,
                UsageLog {
                    provider: "SEEDANCE",
                    endpoint: "video/submit",
                    unit: "seconds",
                    quantity: actual_duration_sec,
                    cost_usd: None,
                },
            )
            .await?;
        }

        self.complete_stage(run_id, &StageType::SegmentGeneration, app)
            .await
    }

    async fn real_render_stage(
        &self,
        task_id: &str,
        run_id: &str,
        app: &AppHandle,
        task: &Task,
        scene_count: i32,
    ) -> AppResult<()> {
        self.begin_stage(run_id, &StageType::FinalRender, app)
            .await?;
        let final_path = self.assets.final_path(task_id);
        if final_path.exists() {
            self.log(
                task_id,
                run_id,
                app,
                "info",
                "Final video already exists; skipping render",
            )
            .await?;
            self.ensure_final_video_asset(task_id, run_id, &final_path)
                .await?;
            return self
                .complete_stage(run_id, &StageType::FinalRender, app)
                .await;
        }

        let mut segment_paths = Vec::with_capacity(scene_count as usize);
        for index in 0..scene_count {
            let segment_path = self.assets.segment_path(task_id, index);
            if !segment_path.exists() {
                return Err(AppError::Workflow(format!(
                    "video segment missing for scene {index}"
                )));
            }
            segment_paths.push(segment_path);
        }
        if segment_paths.is_empty() {
            return Err(AppError::Workflow("no segments to render".into()));
        }

        let workdir = self
            .workspace
            .root()
            .join("temp")
            .join(format!("{task_id}-{run_id}-render"));
        tokio::fs::create_dir_all(&workdir).await?;
        let render_result = async {
            let narration_path = self.assets.narration_path(task_id);
            let audio = if narration_path.exists() {
                Some(narration_path)
            } else {
                None
            };
            let scenes = self.scenes_for_run(task_id, run_id).await?;

            // With narration, subtitles and audio follow the raw ttsDurationMs
            // timeline; each segment must match it or the tracks drift apart.
            let concat_inputs = if audio.is_some() {
                self.log(
                    task_id,
                    run_id,
                    app,
                    "info",
                    "Aligning segment durations to narration",
                )
                .await?;
                let mut aligned = Vec::with_capacity(segment_paths.len());
                for (index, segment) in segment_paths.iter().enumerate() {
                    let target = match scenes
                        .iter()
                        .find(|scene| scene.scene_index == index as i32)
                    {
                        Some(scene) => scene_narration_secs(scene),
                        None => self.ffmpeg.probe_duration(segment).await?,
                    };
                    let fitted = workdir.join(format!("aligned_{index:03}.mp4"));
                    self.ffmpeg
                        .fit_segment_duration(segment, &fitted, target)
                        .await?;
                    aligned.push(fitted);
                }
                aligned
            } else {
                segment_paths.clone()
            };

            self.log(task_id, run_id, app, "info", "Concatenating segments")
                .await?;
            let concat_path = workdir.join("concat.mp4");
            self.ffmpeg
                .concat_segments(&concat_inputs, &concat_path)
                .await?;

            let video_size = self.ffmpeg.probe_video_size(&concat_path).await.ok();
            let cues = cues_from_scenes_with_tts(&scenes);
            let ass_path = workdir.join("subs.ass");
            build_ass(
                &cues,
                &ass_path,
                &ass_style_from_config(&task.config_json),
                video_size,
            )
            .await?;

            self.log(
                task_id,
                run_id,
                app,
                "info",
                "Muxing TTS audio + burning subtitles",
            )
            .await?;
            let rendered_path = workdir.join("rendered.mp4");
            self.ffmpeg
                .render_final(
                    &concat_path,
                    &rendered_path,
                    audio.as_deref(),
                    Some(&ass_path),
                )
                .await?;
            self.assets.copy_file(&rendered_path, &final_path).await?;
            Ok::<(), AppError>(())
        }
        .await;
        let _ = tokio::fs::remove_dir_all(&workdir).await;
        render_result?;

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

    async fn scenes_for_run(&self, task_id: &str, run_id: &str) -> AppResult<Vec<Scene>> {
        let scenes = self.repo.list_scenes(run_id).await?;
        if !scenes.is_empty() {
            return Ok(scenes);
        }
        self.repo.list_scenes_for_task(task_id).await
    }

    async fn poll_segment_with_cancel(
        &self,
        task_id: &str,
        run_id: &str,
        app: &AppHandle,
        seedance: &SeedanceClient,
        job_id: &str,
        scene_index: i32,
    ) -> AppResult<String> {
        use std::time::Duration;
        use tokio::time::sleep;

        const SEGMENT_POLL_INTERVAL_SECS: u64 = 10;
        const SEGMENT_TIMEOUT_SECS: u64 = 1800;

        let deadline = tokio::time::Instant::now() + Duration::from_secs(SEGMENT_TIMEOUT_SECS);
        loop {
            if self.is_canceled(task_id).await? {
                self.cancel_pipeline(task_id, run_id, app).await?;
                return Err(AppError::Workflow("workflow canceled".into()));
            }
            let polled = match seedance.poll_segment(job_id).await {
                Ok(result) => result,
                Err(AppError::Provider(message)) if is_transient_provider_error(&message) => {
                    if tokio::time::Instant::now() > deadline {
                        return Err(AppError::Provider(format!(
                            "Scene {scene_index}: segment timed out after {SEGMENT_TIMEOUT_SECS}s (last error: {message})"
                        )));
                    }
                    self.log(
                        task_id,
                        run_id,
                        app,
                        "warn",
                        &format!(
                            "Scene {scene_index}: Seedance poll network error, retrying in {SEGMENT_POLL_INTERVAL_SECS}s"
                        ),
                    )
                    .await?;
                    sleep(Duration::from_secs(SEGMENT_POLL_INTERVAL_SECS)).await;
                    continue;
                }
                Err(error) => return Err(error),
            };
            match polled.status {
                SegmentPollStatus::Ready => {
                    return polled.source_url.ok_or_else(|| {
                        AppError::Provider("Seedance returned READY without video URL".into())
                    });
                }
                SegmentPollStatus::Failed => {
                    return Err(AppError::Provider(format!(
                        "Scene {scene_index}: segment generation failed"
                    )));
                }
                SegmentPollStatus::Pending => {
                    if tokio::time::Instant::now() > deadline {
                        return Err(AppError::Provider(format!(
                            "Scene {scene_index}: segment timed out after {SEGMENT_TIMEOUT_SECS}s"
                        )));
                    }
                    sleep(Duration::from_secs(SEGMENT_POLL_INTERVAL_SECS)).await;
                }
            }
        }
    }

    async fn ensure_final_video_asset(
        &self,
        task_id: &str,
        run_id: &str,
        final_path: &std::path::Path,
    ) -> AppResult<()> {
        if self
            .repo
            .has_task_asset(task_id, AssetType::FinalVideo)
            .await?
        {
            return Ok(());
        }
        let final_video = asset_for_path(
            task_id,
            run_id,
            AssetType::FinalVideo,
            final_path.to_path_buf(),
            "video/mp4",
            None,
        );
        self.repo.insert_asset(&final_video).await
    }

    async fn cancel_pipeline(&self, task_id: &str, run_id: &str, app: &AppHandle) -> AppResult<()> {
        self.repo.cancel_run(run_id).await?;
        self.log(task_id, run_id, app, "warn", "workflow canceled")
            .await?;
        emit_pipeline_event(
            app,
            PipelineEvent::Run {
                run_id: run_id.to_string(),
                task_id: task_id.to_string(),
                status: "CANCELLED".to_string(),
            },
        );
        Ok(())
    }

    async fn mock_transcript_stage(
        &self,
        task_id: &str,
        run_id: &str,
        app: &AppHandle,
    ) -> AppResult<()> {
        self.begin_stage(run_id, &StageType::TranscriptExtraction, app)
            .await?;
        self.log(
            task_id,
            run_id,
            app,
            "info",
            "Extracting transcript and audio (mock)",
        )
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
        self.record_usage(
            task_id,
            run_id,
            UsageLog {
                provider: "ASR",
                endpoint: "transcribe",
                unit: "seconds",
                quantity: 15.0,
                cost_usd: Some(0.0),
            },
        )
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
            task_id,
            run_id,
            UsageLog {
                provider: "QWEN_VL",
                endpoint: "analyze_frames",
                unit: "images",
                quantity: scene_count as f64,
                cost_usd: Some(0.0),
            },
        )
        .await?;

        let tone = task
            .config_json
            .get("rewriteTone")
            .and_then(|value| value.as_str())
            .unwrap_or("faithful");
        self.log(
            task_id,
            run_id,
            app,
            "info",
            "Rewriting script with visual context",
        )
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
            task_id,
            run_id,
            UsageLog {
                provider: "DEEPSEEK",
                endpoint: "chat/completions",
                unit: "tokens",
                quantity: scene_count as f64 * 150.0,
                cost_usd: Some(0.0),
            },
        )
        .await?;

        self.complete_stage(run_id, &StageType::ScriptRewrite, app)
            .await
    }

    async fn mock_script_planning_stage(
        &self,
        task_id: &str,
        run_id: &str,
        app: &AppHandle,
        task: &Task,
        scene_count: i32,
    ) -> AppResult<()> {
        self.begin_stage(run_id, &StageType::ScriptPlanning, app)
            .await?;
        let tone = task
            .config_json
            .get("rewriteTone")
            .and_then(|value| value.as_str())
            .unwrap_or("faithful");
        for index in 0..scene_count {
            let source_image = self.assets.source_image_path(task_id, index);
            if !source_image.exists() {
                self.assets.write_minimal_png(&source_image).await?;
            }
            let frame_path = self.assets.frame_path(task_id, index);
            self.assets.copy_file(&source_image, &frame_path).await?;
            let frame = asset_for_path(
                task_id,
                run_id,
                AssetType::GeneratedFrame,
                frame_path.clone(),
                "image/png",
                Some(index),
            );
            self.repo.insert_asset(&frame).await?;
            let scene = Scene {
                id: Uuid::new_v4().to_string(),
                task_id: task_id.to_string(),
                run_id: Some(run_id.to_string()),
                scene_index: index,
                script_text: format!("[{tone}] Mock narration for scene {}.", index + 1),
                visual_prompt: Some(format!("Mock visual for scene {index}")),
                motion_prompt: Some("slow zoom in".to_string()),
                metadata_json: Some(json!({
                    "sourceImagePath": source_image.to_string_lossy(),
                    "framePath": frame_path.to_string_lossy(),
                })),
                created_at: Utc::now(),
            };
            self.repo.insert_scene(&scene).await?;
        }
        self.record_usage(
            task_id,
            run_id,
            UsageLog {
                provider: "DEEPSEEK",
                endpoint: "chat/completions",
                unit: "tokens",
                quantity: scene_count as f64 * 150.0,
                cost_usd: Some(0.0),
            },
        )
        .await?;
        self.complete_stage(run_id, &StageType::ScriptPlanning, app)
            .await
    }

    async fn mock_tts_stage(
        &self,
        task_id: &str,
        run_id: &str,
        app: &AppHandle,
        scene_count: i32,
    ) -> AppResult<()> {
        self.begin_stage(run_id, &StageType::TtsSynthesis, app)
            .await?;
        let scenes = self.scenes_for_run(task_id, run_id).await?;
        let mut segment_paths = Vec::with_capacity(scene_count as usize);
        for index in 0..scene_count {
            let tts_path = self.assets.tts_segment_path(task_id, index);
            self.assets.write_mock_wav(&tts_path).await?;
            if let Some(scene) = scenes.iter().find(|scene| scene.scene_index == index) {
                let mut metadata = scene.metadata_json.clone().unwrap_or_else(|| json!({}));
                if let Some(object) = metadata.as_object_mut() {
                    object.insert("ttsDurationMs".to_string(), Value::Number(3000.into()));
                }
                self.repo
                    .update_scene_metadata(&scene.id, &metadata)
                    .await?;
            }
            let tts_asset = asset_for_path(
                task_id,
                run_id,
                AssetType::TtsSegment,
                tts_path.clone(),
                "audio/wav",
                Some(index),
            );
            self.repo.insert_asset(&tts_asset).await?;
            segment_paths.push(tts_path);
        }
        let narration_path = self.assets.narration_path(task_id);
        self.ffmpeg
            .concat_audio(&segment_paths, &narration_path)
            .await?;
        let narration = asset_for_path(
            task_id,
            run_id,
            AssetType::Audio,
            narration_path,
            "audio/wav",
            None,
        );
        self.repo.insert_asset(&narration).await?;
        self.record_usage(
            task_id,
            run_id,
            UsageLog {
                provider: "COSYVOICE",
                endpoint: "audio/tts/SpeechSynthesizer",
                unit: "characters",
                quantity: scene_count as f64 * 40.0,
                cost_usd: Some(0.0),
            },
        )
        .await?;
        self.complete_stage(run_id, &StageType::TtsSynthesis, app)
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
                task_id,
                run_id,
                UsageLog {
                    provider: "TONGYI",
                    endpoint: "image2image/image-synthesis",
                    unit: "images",
                    quantity: 1.0,
                    cost_usd: Some(0.0),
                },
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
        source_video: Option<&std::path::Path>,
    ) -> AppResult<()> {
        self.begin_stage(run_id, &StageType::SegmentGeneration, app)
            .await?;
        for index in 0..scene_count {
            let segment_path = self.assets.segment_path(task_id, index);
            if let Some(source_video) = source_video {
                self.assets.copy_file(source_video, &segment_path).await?;
            } else {
                let frame_path = self.assets.frame_path(task_id, index);
                let duration = 3.0f64;
                self.ffmpeg
                    .create_still_segment(&frame_path, &segment_path, duration)
                    .await?;
            }
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
                task_id,
                run_id,
                UsageLog {
                    provider: "SEEDANCE",
                    endpoint: "submit_segment",
                    unit: "seconds",
                    quantity: 5.0,
                    cost_usd: Some(0.0),
                },
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
        source_video: Option<&std::path::Path>,
    ) -> AppResult<()> {
        if self.assets.narration_path(task_id).exists() {
            let task = self
                .repo
                .get_task(task_id)
                .await?
                .ok_or_else(|| AppError::Workflow(format!("task not found: {task_id}")))?;
            let scene_count = scene_count_from_config(&task.config_json, task.task_type);
            return self
                .real_render_stage(task_id, run_id, app, &task, scene_count)
                .await;
        }

        self.begin_stage(run_id, &StageType::FinalRender, app)
            .await?;
        self.log(task_id, run_id, app, "info", "Rendering final video (mock)")
            .await?;
        let final_path = self.assets.final_path(task_id);
        if let Some(source_video) = source_video {
            self.assets.copy_file(source_video, &final_path).await?;
        } else {
            return Err(AppError::Workflow(
                "mock render requires source video or TTS narration".into(),
            ));
        }
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

    async fn begin_stage(&self, run_id: &str, stage: &StageType, app: &AppHandle) -> AppResult<()> {
        let task_id = self.repo.run_task_id(run_id).await?;
        let task = self
            .repo
            .get_task(&task_id)
            .await?
            .ok_or_else(|| AppError::Workflow(format!("task not found: {task_id}")))?;
        let order_index = ordered_stages(task.task_type)
            .iter()
            .position(|value| value == stage)
            .unwrap_or(0) as i32;
        self.repo
            .start_stage(run_id, stage.clone(), order_index)
            .await?;
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
        if !self
            .mark_run_failed(task_id, run_id, stage.clone(), error)
            .await?
        {
            return Ok(());
        }
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
        task_id: &str,
        run_id: &str,
        usage: UsageLog<'_>,
    ) -> AppResult<()> {
        self.repo
            .insert_api_usage_log(
                usage.provider,
                Some(task_id),
                Some(run_id),
                usage.endpoint,
                usage.unit,
                usage.quantity,
                usage.cost_usd,
                true,
            )
            .await
    }

    async fn record_deepseek_usage(
        &self,
        task_id: &str,
        run_id: &str,
        usage: DeepSeekUsage,
    ) -> AppResult<()> {
        self.record_usage(
            task_id,
            run_id,
            UsageLog {
                provider: "DEEPSEEK",
                endpoint: "chat/completions",
                unit: "tokens",
                quantity: usage.total_tokens as f64,
                cost_usd: None,
            },
        )
        .await
    }

    async fn mark_run_failed(
        &self,
        task_id: &str,
        run_id: &str,
        stage: StageType,
        error: &str,
    ) -> AppResult<bool> {
        if self.is_canceled(task_id).await? {
            self.repo.cancel_run(run_id).await?;
            return Ok(false);
        }
        self.repo.fail_run(run_id, stage, error).await?;
        self.repo
            .update_task_status(task_id, TaskStatus::Failed)
            .await?;
        Ok(true)
    }

    async fn settle_run_completion(&self, task_id: &str, run_id: &str) -> AppResult<bool> {
        if self.is_canceled(task_id).await? {
            self.repo.cancel_run(run_id).await?;
            return Ok(false);
        }
        self.repo.complete_run(run_id, task_id).await?;
        Ok(true)
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

fn transcript_outputs_ready(assets: &AssetManager, task_id: &str) -> bool {
    assets.audio_path(task_id).exists() && assets.subtitle_path(task_id).exists()
}

async fn rewrite_outputs_ready(
    assets: &AssetManager,
    task_id: &str,
    scene_count: i32,
) -> AppResult<bool> {
    for index in 0..scene_count {
        if !assets.keyframe_path(task_id, index).exists() {
            return Ok(false);
        }
    }
    Ok(assets.subtitle_path(task_id).exists())
}

fn scene_count_from_config(config: &serde_json::Value, task_type: WorkflowTaskType) -> i32 {
    if let Some(count) = config.get("sceneCount").and_then(|value| value.as_i64()) {
        return count.clamp(1, 20) as i32;
    }
    if task_type == WorkflowTaskType::ImageToVideo {
        let image_count = config
            .get("imagePaths")
            .and_then(|value| value.as_array())
            .map(|items| items.len())
            .unwrap_or(1);
        return (image_count as i64).clamp(1, 20) as i32;
    }
    5
}

fn img2img_strength_for_tone(tone: &str) -> f64 {
    match tone {
        "professional" => 0.40,
        "casual" => 0.45,
        "dramatic" => 0.55,
        _ => 0.35,
    }
}

fn resolution_from_config(config: &serde_json::Value) -> Option<String> {
    config
        .get("resolution")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn requirements_from_config(config: &serde_json::Value) -> AppResult<String> {
    config
        .get("requirements")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| AppError::Workflow("image_to_video task requires requirements".into()))
}

async fn script_planning_outputs_ready(
    assets: &AssetManager,
    task_id: &str,
    scene_count: i32,
) -> AppResult<bool> {
    for index in 0..scene_count {
        if !assets.frame_path(task_id, index).exists() {
            return Ok(false);
        }
    }
    Ok(true)
}

fn tts_outputs_ready(assets: &AssetManager, task_id: &str, scene_count: i32) -> bool {
    if !assets.narration_path(task_id).exists() {
        return false;
    }
    for index in 0..scene_count {
        if !assets.tts_segment_path(task_id, index).exists() {
            return false;
        }
    }
    true
}

fn should_correct_subtitles(config: &serde_json::Value) -> bool {
    config
        .get("subtitleSource")
        .and_then(|value| value.as_str())
        .unwrap_or("corrected_asr")
        == "corrected_asr"
}

fn subtitle_target_language(config: &serde_json::Value) -> String {
    if config.get("language").and_then(|value| value.as_str()) == Some("en") {
        "English".to_string()
    } else {
        "Simplified Chinese".to_string()
    }
}

fn scene_storyboard_prompt(scene: &Scene) -> String {
    scene
        .visual_prompt
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(scene.script_text.as_str())
        .to_string()
}

fn scene_seedance_job_id(scene: &Scene) -> Option<String> {
    scene
        .metadata_json
        .as_ref()
        .and_then(|value| value.get("seedanceJobId"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn scene_keyframe_path(
    scene: &Scene,
    task_id: &str,
    assets: &AssetManager,
) -> AppResult<std::path::PathBuf> {
    if let Some(path) = scene
        .metadata_json
        .as_ref()
        .and_then(|value| value.get("keyframePath"))
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
    {
        let keyframe = std::path::PathBuf::from(path);
        if keyframe.exists() {
            return Ok(keyframe);
        }
    }
    let expected = assets.keyframe_path(task_id, scene.scene_index);
    if expected.exists() {
        return Ok(expected);
    }
    Err(AppError::Workflow(format!(
        "keyframe image missing for scene {}: {}",
        scene.scene_index,
        expected.display()
    )))
}

fn scene_narration_secs(scene: &Scene) -> f64 {
    scene
        .metadata_json
        .as_ref()
        .and_then(|metadata| metadata.get("ttsDurationMs"))
        .and_then(|value| value.as_i64())
        .filter(|value| *value > 0)
        .map(|duration_ms| duration_ms as f64 / 1000.0)
        .unwrap_or(3.0)
}

fn scene_duration_secs(scene: &Scene) -> f64 {
    if let Some(duration_ms) = scene
        .metadata_json
        .as_ref()
        .and_then(|metadata| metadata.get("ttsDurationMs"))
        .and_then(|value| value.as_i64())
        .filter(|value| *value > 0)
    {
        return (duration_ms as f64 / 1000.0).clamp(3.0, 10.0);
    }
    scene
        .metadata_json
        .as_ref()
        .and_then(|metadata| {
            let start = metadata.get("startMs")?.as_i64()?;
            let end = metadata.get("endMs")?.as_i64()?;
            Some(((end - start) as f64 / 1000.0).clamp(3.0, 10.0))
        })
        .unwrap_or(5.0)
}

fn generated_segment_usage_seconds(duration_secs: f64) -> AppResult<f64> {
    if duration_secs.is_finite() && duration_secs > 0.0 {
        return Ok(duration_secs);
    }
    Err(AppError::Workflow(format!(
        "generated segment duration is invalid: {duration_secs}"
    )))
}

fn keyframe_subtitle_region_ratio(config: &serde_json::Value) -> AppResult<Option<f64>> {
    let treatment = config
        .get("sourceSubtitleTreatment")
        .and_then(|value| value.as_str())
        .unwrap_or("blur");
    if treatment == "none" {
        return Ok(None);
    }
    if treatment != "blur" {
        return Err(AppError::Workflow(format!(
            "unsupported sourceSubtitleTreatment: {treatment}"
        )));
    }
    Ok(Some(
        config
            .get("sourceSubtitleRegionRatio")
            .and_then(|value| value.as_f64())
            .unwrap_or(DEFAULT_SUBTITLE_REGION_RATIO),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{CreateTaskInput, RunStatus};

    #[test]
    fn generated_segment_usage_seconds_rejects_invalid_values() {
        assert_eq!(generated_segment_usage_seconds(3.5).unwrap(), 3.5);
        assert!(generated_segment_usage_seconds(0.0).is_err());
        assert!(generated_segment_usage_seconds(f64::NAN).is_err());
    }

    #[test]
    fn resolution_from_config_reads_trimmed_string() {
        assert_eq!(
            resolution_from_config(&serde_json::json!({"resolution": "1080p"})),
            Some("1080p".to_string())
        );
        assert_eq!(
            resolution_from_config(&serde_json::json!({"resolution": "  "})),
            None
        );
        assert_eq!(resolution_from_config(&serde_json::json!({})), None);
    }

    #[test]
    fn img2img_strength_follows_rewrite_tone() {
        assert_eq!(img2img_strength_for_tone("faithful"), 0.35);
        assert_eq!(img2img_strength_for_tone("professional"), 0.40);
        assert_eq!(img2img_strength_for_tone("casual"), 0.45);
        assert_eq!(img2img_strength_for_tone("dramatic"), 0.55);
        assert_eq!(img2img_strength_for_tone("unknown"), 0.35);
    }

    fn scene_with_metadata(metadata: Option<serde_json::Value>) -> Scene {
        Scene {
            id: "scene-1".into(),
            task_id: "task-1".into(),
            run_id: None,
            scene_index: 0,
            script_text: "text".into(),
            visual_prompt: None,
            motion_prompt: None,
            metadata_json: metadata,
            created_at: Utc::now(),
        }
    }

    #[test]
    fn scene_narration_secs_matches_subtitle_timeline() {
        // Raw ttsDurationMs, unclamped — must mirror cues_from_scenes_with_tts.
        assert_eq!(
            scene_narration_secs(&scene_with_metadata(Some(
                serde_json::json!({"ttsDurationMs": 12000})
            ))),
            12.0
        );
        assert_eq!(scene_narration_secs(&scene_with_metadata(None)), 3.0);
        assert_eq!(
            scene_narration_secs(&scene_with_metadata(Some(
                serde_json::json!({"ttsDurationMs": 0})
            ))),
            3.0
        );
    }

    async fn test_runner() -> (PipelineRunner, Arc<Repository>) {
        let root = std::env::temp_dir().join(format!("repix-runner-test-{}", Uuid::new_v4()));
        tokio::fs::create_dir_all(&root).await.unwrap();
        let workspace = Workspace::from_root(root);
        let repo = Arc::new(Repository::initialize(&workspace).await.unwrap());
        let config = Arc::new(RwLock::new(AppConfig::default_for(&workspace)));
        let assets = Arc::new(AssetManager::new(workspace));
        let ffmpeg = Arc::new(FfmpegRunner::new(config.clone()));
        let whisper = Arc::new(WhisperRunner::new(config.clone()));
        let runner = PipelineRunner::new(repo.clone(), assets, ffmpeg, whisper, config);
        (runner, repo)
    }

    async fn task_with_run(repo: &Repository) -> (String, String) {
        let task = repo
            .create_task(CreateTaskInput {
                title: "test task".into(),
                source_path: "source.mp4".into(),
                config_json: serde_json::json!({}),
            })
            .await
            .unwrap();
        repo.update_task_status(&task.id, TaskStatus::Running)
            .await
            .unwrap();
        let run = repo.create_run(&task.id).await.unwrap();
        (task.id, run.id)
    }

    async fn canceled_task_with_run(repo: &Repository) -> (String, String) {
        let (task_id, run_id) = task_with_run(repo).await;
        repo.update_task_status(&task_id, TaskStatus::Canceled)
            .await
            .unwrap();
        repo.cancel_run(&run_id).await.unwrap();
        (task_id, run_id)
    }

    #[tokio::test]
    async fn mark_run_failed_preserves_canceled_state() {
        let (runner, repo) = test_runner().await;
        let (task_id, run_id) = canceled_task_with_run(&repo).await;

        let applied = runner
            .mark_run_failed(&task_id, &run_id, StageType::SegmentGeneration, "boom")
            .await
            .unwrap();

        assert!(!applied);
        let task = repo.get_task(&task_id).await.unwrap().unwrap();
        assert!(matches!(task.status, TaskStatus::Canceled));
        let run = repo.latest_run(&task_id).await.unwrap().unwrap();
        assert!(matches!(run.status, RunStatus::Canceled));
    }

    #[tokio::test]
    async fn mark_run_failed_fails_active_run() {
        let (runner, repo) = test_runner().await;
        let (task_id, run_id) = task_with_run(&repo).await;

        let applied = runner
            .mark_run_failed(&task_id, &run_id, StageType::SegmentGeneration, "boom")
            .await
            .unwrap();

        assert!(applied);
        let task = repo.get_task(&task_id).await.unwrap().unwrap();
        assert!(matches!(task.status, TaskStatus::Failed));
        let run = repo.latest_run(&task_id).await.unwrap().unwrap();
        assert!(matches!(run.status, RunStatus::Failed));
    }

    #[tokio::test]
    async fn settle_run_completion_preserves_canceled_state() {
        let (runner, repo) = test_runner().await;
        let (task_id, run_id) = canceled_task_with_run(&repo).await;

        let completed = runner
            .settle_run_completion(&task_id, &run_id)
            .await
            .unwrap();

        assert!(!completed);
        let task = repo.get_task(&task_id).await.unwrap().unwrap();
        assert!(matches!(task.status, TaskStatus::Canceled));
        let run = repo.latest_run(&task_id).await.unwrap().unwrap();
        assert!(matches!(run.status, RunStatus::Canceled));
    }

    #[tokio::test]
    async fn settle_run_completion_completes_active_run() {
        let (runner, repo) = test_runner().await;
        let (task_id, run_id) = task_with_run(&repo).await;

        let completed = runner
            .settle_run_completion(&task_id, &run_id)
            .await
            .unwrap();

        assert!(completed);
        let task = repo.get_task(&task_id).await.unwrap().unwrap();
        assert!(matches!(task.status, TaskStatus::Completed));
        let run = repo.latest_run(&task_id).await.unwrap().unwrap();
        assert!(matches!(run.status, RunStatus::Completed));
    }
}
