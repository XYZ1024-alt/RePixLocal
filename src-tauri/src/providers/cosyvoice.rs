use std::sync::Arc;

use serde_json::{json, Value};

use crate::db::Repository;
use crate::errors::{AppError, AppResult};
use crate::providers::fetch::download_to_file;
use crate::providers::http_client::{build_http_client, format_http_error};

const DEFAULT_MODEL: &str = "cosyvoice-v3-flash";
const DEFAULT_SAMPLE_RATE: i32 = 24_000;

#[derive(Debug, Clone)]
pub struct CosyVoiceClient {
    repo: Arc<Repository>,
}

impl CosyVoiceClient {
    pub fn new(repo: Arc<Repository>) -> Self {
        Self { repo }
    }

    pub async fn synthesize_to_file(
        &self,
        text: &str,
        voice_key: &str,
        language: Option<&str>,
        out_path: &std::path::Path,
    ) -> AppResult<()> {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return Err(AppError::Provider("TTS text is empty".into()));
        }
        let settings = self.repo.get_provider_settings("COSYVOICE").await?;
        let model = if settings.model.trim().is_empty() {
            DEFAULT_MODEL.to_string()
        } else {
            settings.model.clone()
        };
        let voice = map_voice_id(voice_key);
        let mut input = json!({
            "text": trimmed,
            "voice": voice,
            "format": "wav",
            "sample_rate": DEFAULT_SAMPLE_RATE,
        });
        if let Some(language) = language_hint(language) {
            input["language_hints"] = json!([language]);
        }
        let payload = json!({
            "model": model,
            "input": input,
        });
        let base_url = settings.base_url.trim().trim_end_matches('/');
        let url = format!("{base_url}/api/v1/services/audio/tts/SpeechSynthesizer");
        let client = build_http_client(120)?;
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
                "CosyVoice API error {status}: {body}"
            )));
        }
        let body: Value = response
            .json()
            .await
            .map_err(|error| AppError::Provider(error.to_string()))?;
        let audio_url = body
            .pointer("/output/audio/url")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                AppError::Provider(format!("CosyVoice returned no audio URL: {body}"))
            })?;
        if let Some(parent) = out_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        download_to_file(audio_url, out_path).await
    }
}

pub fn map_voice_id(voice_key: &str) -> &'static str {
    match voice_key {
        "male-1" => "longanyang",
        "narrator" => "longjing_v2",
        _ => "longxiaochun_v2",
    }
}

fn language_hint(language: Option<&str>) -> Option<&'static str> {
    match language {
        Some("en") => Some("en"),
        Some("zh") => Some("zh"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_mapping() {
        assert_eq!(map_voice_id("female-1"), "longxiaochun_v2");
        assert_eq!(map_voice_id("male-1"), "longanyang");
        assert_eq!(map_voice_id("narrator"), "longjing_v2");
    }
}