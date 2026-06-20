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

#[derive(Debug, Clone, Copy)]
pub struct CosyVoiceOutput {
    pub characters: usize,
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
    ) -> AppResult<CosyVoiceOutput> {
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
        let url = cosyvoice_synthesizer_url(&settings.base_url);
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
        download_to_file(audio_url, out_path).await?;
        Ok(CosyVoiceOutput {
            characters: text_character_count(trimmed),
        })
    }
}

pub fn map_voice_id(voice_key: &str) -> &'static str {
    // cosyvoice-v3-flash uses v3 system voices (see CosyVoice voice list).
    match voice_key {
        "male-1" => "longanyang",
        "narrator" => "longsanshu_v3",
        _ => "longwan_v3",
    }
}

fn cosyvoice_synthesizer_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.ends_with("/api/v1") {
        format!("{trimmed}/services/audio/tts/SpeechSynthesizer")
    } else {
        format!("{trimmed}/api/v1/services/audio/tts/SpeechSynthesizer")
    }
}

fn language_hint(language: Option<&str>) -> Option<&'static str> {
    match language {
        Some("en") => Some("en"),
        Some("zh") => Some("zh"),
        _ => None,
    }
}

fn text_character_count(text: &str) -> usize {
    text.chars().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_mapping() {
        assert_eq!(map_voice_id("female-1"), "longwan_v3");
        assert_eq!(map_voice_id("male-1"), "longanyang");
        assert_eq!(map_voice_id("narrator"), "longsanshu_v3");
    }

    #[test]
    fn synthesizer_url_appends_service_path_once() {
        assert_eq!(
            cosyvoice_synthesizer_url("https://dashscope.aliyuncs.com/api/v1"),
            "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer"
        );
        assert_eq!(
            cosyvoice_synthesizer_url("https://dashscope.aliyuncs.com"),
            "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer"
        );
    }

    #[test]
    fn text_character_count_counts_trimmed_input() {
        assert_eq!(text_character_count("你好abc"), 5);
    }
}
