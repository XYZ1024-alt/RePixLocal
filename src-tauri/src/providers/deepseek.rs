use std::sync::Arc;

use serde_json::{json, Value};

use crate::db::Repository;
use crate::errors::{AppError, AppResult};
use crate::providers::http_client::{build_http_client, format_http_error};
use crate::models::{RewrittenScene, TranscriptSegment};
use crate::providers::json_util::parse_json_payload;

const SYSTEM_PROMPT_WITH_VISUALS: &str = r#"You are a video director creating a replicated video that maintains visual similarity to the source.

For each of the {n} scenes, you have:
- Original narration transcript
- Visual description of the source frame from that scene

Your task: Generate a NEW scene that is VISUALLY SIMILAR but not identical.

For EACH scene output these fields:

1. **scriptText**: Rewritten narration in tone '{tone}'. Keep the SAME language as source.

2. **visualPrompt**: Enhanced visual description for img2img generation.
   - START with the source visual description (provided below)
   - KEEP: subject type, setting, composition, lighting style, color tone
   - VARY slightly: clothing details (color/pattern), minor background elements, camera distance (±10%)
   - DO NOT include source subtitles, on-screen text overlays, readable brand/logo text, or copyrighted character names.
   - Goal: new frame looks like it's from the SAME video shoot, just a different take
   - Write in English

3. **motionPrompt**: Camera and subject movement in English.

Source scenes:
{visual_context}

Output JSON array only:
[{"index": 0, "scriptText": "...", "visualPrompt": "...", "motionPrompt": "..."}, ...]"#;

const SYSTEM_PROMPT_IMAGE_PLANNING: &str = r#"You are a video director. The user provides reference images and a creative brief.

For each of the {n} scenes (one per image), you have a visual description from image analysis.

Your task: write narration and motion for a short video using these images.

For EACH scene output:
1. **scriptText**: narration matching the brief and image content, in tone '{tone}'. Use the same language as the brief.
2. **motionPrompt**: camera and subject movement in English.

Rules:
- Do not invent scenes beyond the image count.
- Keep each scriptText concise enough for a short video segment (1-3 sentences).

Image scenes:
{visual_context}

Output JSON array only:
[{"index": 0, "scriptText": "...", "motionPrompt": "..."}, ...]"#;

const SUBTITLE_CORRECTION_PROMPT: &str = r#"You are a subtitle proofreader. Correct ASR subtitle text while preserving the speaker's original meaning.
Rules:
- Return ONLY a JSON array.
- Return exactly {n} items, in the same order as the input.
- Each item must be {"index": int, "text": str}.
- Do not add, remove, split, merge, or reorder subtitles.
- Do not include startMs or endMs.
- Correct homophones, punctuation, and obvious ASR errors.
- Keep wording concise enough for subtitles.
- Output language: {target_language}.
- If output language is Simplified Chinese, use Simplified Chinese only; do not output Traditional Chinese."#;

#[derive(Debug, Clone)]
pub struct DeepSeekClient {
    repo: Arc<Repository>,
}

impl DeepSeekClient {
    pub fn new(repo: Arc<Repository>) -> Self {
        Self { repo }
    }

    pub async fn correct_subtitles(
        &self,
        segments: &[TranscriptSegment],
        target_language: &str,
    ) -> AppResult<Vec<TranscriptSegment>> {
        let settings = self.repo.get_provider_settings("DEEPSEEK").await?;
        let items: Vec<Value> = segments
            .iter()
            .enumerate()
            .map(|(index, segment)| {
                json!({
                    "index": index,
                    "text": segment.text,
                })
            })
            .collect();
        let user_content = serde_json::to_string(&items)?;
        let payload = json!({
            "model": settings.model,
            "messages": [
                {
                    "role": "system",
                    "content": SUBTITLE_CORRECTION_PROMPT
                        .replace("{n}", &segments.len().to_string())
                        .replace("{target_language}", target_language),
                },
                {
                    "role": "user",
                    "content": user_content,
                }
            ],
        });
        let content = self.chat_completion(&settings, payload).await?;
        let corrections = parse_subtitle_corrections(&content, segments.len())?;
        Ok(merge_subtitle_corrections(segments, &corrections))
    }

    pub async fn rewrite_script_with_visuals(
        &self,
        transcript: &str,
        visual_descriptions: &[String],
        keyframe_paths: &[String],
        tone: &str,
        target_scenes: i32,
    ) -> AppResult<Vec<RewrittenScene>> {
        let settings = self.repo.get_provider_settings("DEEPSEEK").await?;
        let visual_context = visual_descriptions
            .iter()
            .enumerate()
            .map(|(index, description)| format!("Scene {index}: {description}"))
            .collect::<Vec<_>>()
            .join("\n");
        let payload = json!({
            "model": settings.model,
            "messages": [
                {
                    "role": "system",
                    "content": SYSTEM_PROMPT_WITH_VISUALS
                        .replace("{n}", &target_scenes.to_string())
                        .replace("{tone}", tone)
                        .replace("{visual_context}", &visual_context),
                },
                {
                    "role": "user",
                    "content": transcript,
                }
            ],
        });
        let content = self.chat_completion(&settings, payload).await?;
        let mut scenes = parse_scenes(&content, target_scenes)?;
        for (index, scene) in scenes.iter_mut().enumerate() {
            if index < keyframe_paths.len() {
                scene.keyframe_path = Some(keyframe_paths[index].clone());
            }
        }
        Ok(scenes)
    }

    pub async fn plan_script_from_images(
        &self,
        requirements: &str,
        visual_descriptions: &[String],
        tone: &str,
        target_scenes: i32,
    ) -> AppResult<Vec<RewrittenScene>> {
        let settings = self.repo.get_provider_settings("DEEPSEEK").await?;
        let visual_context = visual_descriptions
            .iter()
            .enumerate()
            .map(|(index, description)| format!("Scene {index}: {description}"))
            .collect::<Vec<_>>()
            .join("\n");
        let payload = json!({
            "model": settings.model,
            "messages": [
                {
                    "role": "system",
                    "content": SYSTEM_PROMPT_IMAGE_PLANNING
                        .replace("{n}", &target_scenes.to_string())
                        .replace("{tone}", tone)
                        .replace("{visual_context}", &visual_context),
                },
                {
                    "role": "user",
                    "content": requirements,
                }
            ],
        });
        let content = self.chat_completion(&settings, payload).await?;
        parse_scenes(&content, target_scenes)
    }

    async fn chat_completion(
        &self,
        settings: &crate::models::ProviderSettings,
        payload: Value,
    ) -> AppResult<String> {
        let base_url = normalize_openai_base_url(&settings.base_url);
        let client = build_http_client(120)?;
        let url = format!("{base_url}/chat/completions");
        let response = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", settings.api_key))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(|error| AppError::Provider(format_http_error(&url, &error)))?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::Provider(format!(
                "DeepSeek API error {status}: {body}"
            )));
        }
        let body: Value = response
            .json()
            .await
            .map_err(|error| AppError::Provider(error.to_string()))?;
        body["choices"][0]["message"]["content"]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| AppError::Provider("DeepSeek returned empty content".into()))
    }
}

fn normalize_openai_base_url(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/v1")
    }
}

fn parse_scenes(content: &str, target_scenes: i32) -> AppResult<Vec<RewrittenScene>> {
    let data = parse_json_payload(content)?;
    let items = match data {
        Value::Array(items) => items,
        Value::Object(map) => map
            .get("scenes")
            .cloned()
            .or_else(|| map.values().next().cloned())
            .and_then(|value| value.as_array().cloned())
            .ok_or_else(|| AppError::Provider("DeepSeek scene payload is not an array".into()))?,
        _ => {
            return Err(AppError::Provider(
                "DeepSeek scene payload must be a JSON array".into(),
            ))
        }
    };
    let mut scenes = Vec::new();
    for (index, item) in items.into_iter().take(target_scenes as usize).enumerate() {
        let script_text = item
            .get("scriptText")
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::Provider(format!("scene {index} missing scriptText")))?;
        scenes.push(RewrittenScene {
            index: item
                .get("index")
                .and_then(Value::as_i64)
                .unwrap_or(index as i64) as i32,
            script_text: script_text.to_string(),
            visual_prompt: item
                .get("visualPrompt")
                .and_then(Value::as_str)
                .map(str::to_string),
            motion_prompt: item
                .get("motionPrompt")
                .and_then(Value::as_str)
                .map(str::to_string),
            keyframe_path: None,
            start_ms: item.get("startMs").and_then(Value::as_i64),
            end_ms: item.get("endMs").and_then(Value::as_i64),
        });
    }
    Ok(scenes)
}

fn parse_subtitle_corrections(content: &str, expected_count: usize) -> AppResult<Vec<String>> {
    let data = parse_json_payload(content)?;
    let items = data.as_array().ok_or_else(|| {
        AppError::Provider("DeepSeek subtitle correction must return a JSON array".into())
    })?;
    if items.len() != expected_count {
        return Err(AppError::Provider(format!(
            "DeepSeek returned {} subtitle corrections, expected {expected_count}",
            items.len()
        )));
    }
    items
        .iter()
        .enumerate()
        .map(|(index, item)| {
            let actual_index = item
                .get("index")
                .and_then(Value::as_i64)
                .ok_or_else(|| AppError::Provider(format!("subtitle {index} missing index")))?;
            if actual_index != index as i64 {
                return Err(AppError::Provider(format!(
                    "subtitle correction index mismatch: expected {index}, got {actual_index}"
                )));
            }
            item.get("text")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .ok_or_else(|| AppError::Provider(format!("subtitle {index} missing text")))
        })
        .collect()
}

fn merge_subtitle_corrections(
    segments: &[TranscriptSegment],
    corrections: &[String],
) -> Vec<TranscriptSegment> {
    segments
        .iter()
        .zip(corrections.iter())
        .map(|(segment, text)| TranscriptSegment {
            start_ms: segment.start_ms,
            end_ms: segment.end_ms,
            text: text.clone(),
        })
        .collect()
}