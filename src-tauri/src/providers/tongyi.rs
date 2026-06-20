use std::path::Path;
use std::sync::Arc;

use serde_json::{json, Value};

use crate::db::Repository;
use crate::errors::{AppError, AppResult};
use crate::providers::http_client::format_http_error;
use crate::providers::image_payload::image_data_url;

const DEFAULT_IMAGE_SIZE: &str = "1280*720";
const WAN_MULTIMODAL_SIZE: &str = "2K";
const WAN27_MODEL_PREFIX: &str = "wan2.7-image";

const UNSAFE_PROMPT_TERMS: &[&str] = &[
    "caption",
    "copyrighted",
    "disney",
    "logo",
    "mickey mouse",
    "overlaid text",
    "printed text",
    "readable text",
    "subtitle",
    "text reads",
    "text overlay",
];

#[derive(Debug, Clone)]
pub struct TongyiOutput {
    pub source_url: String,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone)]
pub struct TongyiClient {
    repo: Arc<Repository>,
}

impl TongyiClient {
    pub fn new(repo: Arc<Repository>) -> Self {
        Self { repo }
    }

    pub async fn generate_frame_img2img(
        &self,
        source_path: &Path,
        prompt: &str,
        scene_index: i32,
        _strength: f64,
        aspect_ratio: &str,
    ) -> AppResult<TongyiOutput> {
        let prompt = provider_safe_prompt(prompt)?;
        let settings = self.repo.get_provider_settings("TONGYI").await?;
        let model = settings.model.clone();
        if uses_wan_multimodal_api(&model) {
            let (_, width, height) = legacy_size_for_aspect(aspect_ratio);
            let ref_image = image_data_url(source_path).await?;
            tracing::info!("Tongyi scene {scene_index} using inline base64 reference image");
            return self
                .generate_wan_multimodal(&settings, &model, &ref_image, &prompt, width, height)
                .await;
        }
        Err(AppError::Provider(
            "Tongyi legacy models require a public image URL. Switch to a wan2.7-image model."
                .into(),
        ))
    }

    async fn generate_wan_multimodal(
        &self,
        settings: &crate::models::ProviderSettings,
        model: &str,
        ref_image_url: &str,
        prompt: &str,
        width: i32,
        height: i32,
    ) -> AppResult<TongyiOutput> {
        let base_url = settings.base_url.trim_end_matches('/');
        let client = http_client()?;
        let payload = json!({
            "model": model,
            "input": {
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            { "image": ref_image_url },
                            { "text": prompt }
                        ]
                    }
                ]
            },
            "parameters": { "size": WAN_MULTIMODAL_SIZE, "n": 1, "watermark": false }
        });
        let url = format!("{base_url}/services/aigc/multimodal-generation/generation");
        let response = client
            .post(&url)
            .headers(json_headers(&settings.api_key))
            .json(&payload)
            .send()
            .await
            .map_err(|error| AppError::Provider(format_http_error(&url, &error)))?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::Provider(format!(
                "Tongyi Wan multimodal error ({status}): {body}"
            )));
        }
        let body: Value = response
            .json()
            .await
            .map_err(|error| AppError::Provider(error.to_string()))?;
        extract_result(&body, width, height)
    }
}

fn extract_result(body: &Value, width: i32, height: i32) -> AppResult<TongyiOutput> {
    if let Some(url) = body
        .pointer("/output/results/0/url")
        .and_then(Value::as_str)
    {
        return Ok(TongyiOutput {
            source_url: url.to_string(),
            width,
            height,
        });
    }
    if let Some(choices) = body.pointer("/output/choices").and_then(Value::as_array) {
        for choice in choices {
            if let Some(content) = choice.pointer("/message/content").and_then(Value::as_array) {
                for item in content {
                    if item.get("type").and_then(Value::as_str) == Some("image") {
                        if let Some(url) = item.get("image").and_then(Value::as_str) {
                            return Ok(TongyiOutput {
                                source_url: url.to_string(),
                                width,
                                height,
                            });
                        }
                    }
                }
            }
        }
    }
    Err(AppError::Provider(format!(
        "Tongyi result missing image URL: {body}"
    )))
}

fn legacy_size_for_aspect(aspect_ratio: &str) -> (String, i32, i32) {
    let size = match aspect_ratio {
        "16:9" => "1280*720",
        "9:16" => "720*1280",
        _ => DEFAULT_IMAGE_SIZE,
    };
    let mut parts = size.split('*');
    let width = parts.next().and_then(|v| v.parse().ok()).unwrap_or(1280);
    let height = parts.next().and_then(|v| v.parse().ok()).unwrap_or(720);
    (size.to_string(), width, height)
}

fn uses_wan_multimodal_api(model: &str) -> bool {
    model.starts_with(WAN27_MODEL_PREFIX)
}

fn provider_safe_prompt(prompt: &str) -> AppResult<String> {
    let safe: Vec<String> = split_sentences(prompt)
        .into_iter()
        .filter(|sentence| !contains_unsafe_prompt_term(sentence))
        .collect();
    if safe.is_empty() {
        return Err(AppError::Provider(
            "Tongyi prompt contains no safe visual content after text cleanup".into(),
        ));
    }
    Ok(safe.join(" "))
}

fn split_sentences(prompt: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut current = String::new();
    for ch in prompt.chars() {
        current.push(ch);
        if ".!?。！？".contains(ch) {
            let trimmed = current.trim().to_string();
            if !trimmed.is_empty() {
                sentences.push(trimmed);
            }
            current.clear();
        }
    }
    let trimmed = current.trim().to_string();
    if !trimmed.is_empty() {
        sentences.push(trimmed);
    }
    sentences
}

fn contains_unsafe_prompt_term(sentence: &str) -> bool {
    let lower = sentence.to_lowercase();
    UNSAFE_PROMPT_TERMS.iter().any(|term| lower.contains(term))
}

fn http_client() -> AppResult<reqwest::Client> {
    crate::providers::http_client::build_http_client(180)
}

fn json_headers(api_key: &str) -> reqwest::header::HeaderMap {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::AUTHORIZATION,
        reqwest::header::HeaderValue::from_str(&format!("Bearer {api_key}"))
            .unwrap_or_else(|_| reqwest::header::HeaderValue::from_static("Bearer")),
    );
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        reqwest::header::HeaderValue::from_static("application/json"),
    );
    headers
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wan_multimodal_model_detection() {
        assert!(uses_wan_multimodal_api("wan2.7-image-v1"));
        assert!(!uses_wan_multimodal_api("wanx-v1"));
    }

    #[test]
    fn provider_safe_prompt_filters_subtitle_terms() {
        let prompt = "A person at a desk. Subtitle text reads hello. Warm lighting.";
        let safe = provider_safe_prompt(prompt).unwrap();
        assert!(!safe.to_lowercase().contains("subtitle"));
        assert!(safe.contains("Warm lighting"));
    }

    #[test]
    fn provider_safe_prompt_rejects_all_unsafe_sentences() {
        let prompt = "Readable text overlay on the frame.";
        assert!(provider_safe_prompt(prompt).is_err());
    }

    #[test]
    fn legacy_size_for_9_16_aspect() {
        let (size, width, height) = legacy_size_for_aspect("9:16");
        assert_eq!(size, "720*1280");
        assert_eq!((width, height), (720, 1280));
    }
}
