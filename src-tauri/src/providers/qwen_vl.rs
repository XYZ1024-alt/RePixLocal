use std::path::Path;
use std::sync::Arc;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;

use serde_json::{json, Value};

use crate::db::Repository;
use crate::errors::{AppError, AppResult};
use crate::providers::http_client::{build_http_client, format_http_error};

const FRAME_PROMPT: &str = "Describe this video frame in detail for image generation purposes. \
Include:\n\
- Subject: who/what is the main focus (appearance, clothing, posture, expression)\n\
- Setting: where (location type, indoor/outdoor, time of day)\n\
- Composition: shot type (close-up/medium/wide), camera angle, framing\n\
- Lighting: quality and direction (soft/harsh, light source position)\n\
- Color palette: dominant colors and mood\n\
- Style: visual aesthetic (photorealistic, cinematic, etc.)\n\
- Details: notable props, textures, background elements\n\n\
Be specific and concrete. Avoid vague words like 'beautiful' or 'nice'. \
Ignore subtitles, captions, readable logo text, text overlays, and copyrighted character names; \
describe those only as generic visual shapes or decorative graphics when they affect composition. \
Output in English only.";

#[derive(Debug, Clone)]
pub struct QwenVlClient {
    repo: Arc<Repository>,
}

#[derive(Debug, Clone)]
pub struct FrameAnalysisResult {
    pub descriptions: Vec<String>,
    pub frame_count: usize,
}

impl QwenVlClient {
    pub fn new(repo: Arc<Repository>) -> Self {
        Self { repo }
    }

    pub async fn analyze_video_frames(
        &self,
        frame_paths: &[impl AsRef<Path>],
    ) -> AppResult<FrameAnalysisResult> {
        let settings = self.repo.get_provider_settings("QWEN_VL").await?;
        let base_url = settings.base_url.trim_end_matches('/').to_string();
        let client = build_http_client(300)?;
        let mut descriptions = Vec::with_capacity(frame_paths.len());
        for (index, frame_path) in frame_paths.iter().enumerate() {
            let bytes = tokio::fs::read(frame_path.as_ref())
                .await
                .map_err(AppError::from)?;
            let image_b64 = STANDARD.encode(bytes);
            let data_url = format!("data:image/png;base64,{image_b64}");
            let payload = json!({
                "model": settings.model,
                "input": {
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                { "image": data_url },
                                { "text": FRAME_PROMPT }
                            ]
                        }
                    ]
                }
            });
            let url = format!(
                "{base_url}/services/aigc/multimodal-generation/generation"
            );
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
                    "Qwen-VL API error on frame {index} ({status}): {body}"
                )));
            }
            let body: Value = response
                .json()
                .await
                .map_err(|error| AppError::Provider(error.to_string()))?;
            let description = extract_description(&body, index)?;
            descriptions.push(description);
        }
        let frame_count = descriptions.len();
        Ok(FrameAnalysisResult {
            descriptions,
            frame_count,
        })
    }
}

fn extract_description(body: &Value, index: usize) -> AppResult<String> {
    let choices = body
        .pointer("/output/choices")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            AppError::Provider(format!("Qwen-VL returned no choices for frame {index}"))
        })?;
    let content = choices
        .first()
        .and_then(|choice| choice.pointer("/message/content"))
        .and_then(Value::as_array)
        .ok_or_else(|| {
            AppError::Provider(format!("Qwen-VL returned invalid content for frame {index}"))
        })?;
    let text = content
        .iter()
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();
    if text.is_empty() {
        return Err(AppError::Provider(format!(
            "Qwen-VL returned empty description for frame {index}"
        )));
    }
    Ok(text)
}