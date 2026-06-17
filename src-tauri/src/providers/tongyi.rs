use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use reqwest::Client;
use serde_json::{json, Value};
use tokio::time::sleep;

use crate::db::Repository;
use crate::errors::{AppError, AppResult};
use crate::storage::oss::OssClient;

const DEFAULT_IMAGE_SIZE: &str = "1280*720";
const LEGACY_REF_MODE: &str = "repaint";
const POLL_INTERVAL_SECONDS: u64 = 2;
const POLL_MAX_ATTEMPTS: usize = 60;
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
        oss: &OssClient,
        source_key: &str,
        source_path: &Path,
        prompt: &str,
        scene_index: i32,
        strength: f64,
        aspect_ratio: &str,
    ) -> AppResult<TongyiOutput> {
        oss.put_file(source_key, source_path, "image/png").await?;
        let ref_image_url = oss.public_url(source_key).await?;
        tracing::info!("Tongyi scene {scene_index} reference URL: {ref_image_url}");
        let prompt = provider_safe_prompt(prompt)?;
        let settings = self.repo.get_provider_settings("TONGYI").await?;
        let (size, width, height) = legacy_size_for_aspect(aspect_ratio);
        let model = settings.model.clone();
        if uses_wan_multimodal_api(&model) {
            return self
                .generate_wan_multimodal(&settings, &model, &ref_image_url, &prompt, width, height)
                .await;
        }
        let ref_strength = 1.0 - strength;
        self.generate_legacy(
            &settings,
            &model,
            &ref_image_url,
            &prompt,
            ref_strength,
            &size,
            width,
            height,
        )
        .await
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
        let response = client
            .post(format!(
                "{base_url}/services/aigc/multimodal-generation/generation"
            ))
            .headers(json_headers(&settings.api_key))
            .json(&payload)
            .send()
            .await
            .map_err(|error| AppError::Provider(error.to_string()))?;
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

    async fn generate_legacy(
        &self,
        settings: &crate::models::ProviderSettings,
        model: &str,
        ref_image_url: &str,
        prompt: &str,
        ref_strength: f64,
        size: &str,
        width: i32,
        height: i32,
    ) -> AppResult<TongyiOutput> {
        let base_url = settings.base_url.trim_end_matches('/');
        let client = http_client()?;
        let payload = json!({
            "model": model,
            "input": { "prompt": prompt, "ref_image": ref_image_url },
            "parameters": {
                "ref_strength": ref_strength,
                "ref_mode": LEGACY_REF_MODE,
                "size": size,
                "n": 1
            }
        });
        let response = client
            .post(format!("{base_url}/services/aigc/text2image/image-synthesis"))
            .headers(json_headers(&settings.api_key))
            .header("X-DashScope-Async", "enable")
            .json(&payload)
            .send()
            .await
            .map_err(|error| AppError::Provider(error.to_string()))?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::Provider(format!(
                "Tongyi legacy error ({status}): {body}"
            )));
        }
        let body: Value = response
            .json()
            .await
            .map_err(|error| AppError::Provider(error.to_string()))?;
        if let Some(task_id) = body
            .pointer("/output/task_id")
            .and_then(Value::as_str)
        {
            return self
                .poll_legacy_task(settings, task_id, width, height)
                .await;
        }
        extract_result(&body, width, height)
    }

    async fn poll_legacy_task(
        &self,
        settings: &crate::models::ProviderSettings,
        task_id: &str,
        width: i32,
        height: i32,
    ) -> AppResult<TongyiOutput> {
        let base_url = settings.base_url.trim_end_matches('/');
        let client = http_client()?;
        for _ in 0..POLL_MAX_ATTEMPTS {
            let response = client
                .get(format!(
                    "{base_url}/services/aigc/text2image/image-synthesis/{task_id}"
                ))
                .header("Authorization", format!("Bearer {}", settings.api_key))
                .send()
                .await
                .map_err(|error| AppError::Provider(error.to_string()))?;
            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(AppError::Provider(format!(
                    "Tongyi poll error ({status}): {body}"
                )));
            }
            let body: Value = response
                .json()
                .await
                .map_err(|error| AppError::Provider(error.to_string()))?;
            let status = body
                .pointer("/output/task_status")
                .and_then(Value::as_str)
                .unwrap_or_default();
            match status {
                "SUCCEEDED" => return extract_result(&body, width, height),
                "FAILED" | "CANCELED" => {
                    return Err(AppError::Provider(format!(
                        "Tongyi task {task_id} failed: {body}"
                    )));
                }
                _ => sleep(Duration::from_secs(POLL_INTERVAL_SECONDS)).await,
            }
        }
        Err(AppError::Provider(format!(
            "Tongyi task {task_id} timed out after {}s",
            POLL_MAX_ATTEMPTS as u64 * POLL_INTERVAL_SECONDS
        )))
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

fn http_client() -> AppResult<Client> {
    Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| AppError::Provider(error.to_string()))
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