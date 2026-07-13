use std::sync::Arc;

use serde_json::{json, Value};
use tracing::debug;

use crate::db::Repository;
use crate::errors::{AppError, AppResult};
use crate::providers::fetch::{download_to_file, DownloadKind};
use crate::providers::http_client::{build_http_client_direct, format_http_error};

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
        let voice = map_voice_id(voice_key, &model)?;
        let text_characters = text_character_count(trimmed);
        let language_hint = language_hint(language);
        let mut input = json!({
            "text": trimmed,
            "voice": voice,
            "format": "wav",
            "sample_rate": DEFAULT_SAMPLE_RATE,
        });
        if let Some(language) = language_hint {
            input["language_hints"] = json!([language]);
        }
        let payload = json!({
            "model": model,
            "input": input,
        });
        debug!(
            model = %model,
            voice = %voice,
            text_characters,
            "CosyVoice TTS request"
        );
        let url = cosyvoice_synthesizer_url(&settings.base_url);
        let client = build_http_client_direct(120)?;
        let response = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", settings.api_key))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(|error| AppError::Provider(format_http_error(&url, error)))?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::Provider(format!(
                "CosyVoice API error {status} (model {model}, voice option {voice_key}, voice {voice}, language {}, text characters {text_characters}): {body}",
                language_hint.unwrap_or("auto")
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
        download_to_file(audio_url, out_path, DownloadKind::WavAudio).await?;
        Ok(CosyVoiceOutput {
            characters: text_characters,
        })
    }
}

pub fn map_voice_id(voice_key: &str, model: &str) -> AppResult<&'static str> {
    let model = model.trim().to_ascii_lowercase();
    match (model.as_str(), voice_key) {
        // V3 Plus currently supports only longanhuan and longanyang.
        ("cosyvoice-v3-plus", "female-1") => Ok("longanhuan"),
        ("cosyvoice-v3-plus", "male-1") => Ok("longanyang"),
        ("cosyvoice-v3-plus", "narrator") => Err(AppError::Provider(
            "CosyVoice model cosyvoice-v3-plus has no narrator voice; choose female or male, or use cosyvoice-v3-flash"
                .into(),
        )),
        ("cosyvoice-v3-flash", "female-1") => Ok("longxiaochun_v3"),
        ("cosyvoice-v3-flash", "male-1") => Ok("longshu_v3"),
        ("cosyvoice-v3-flash", "narrator") => Ok("loongbella_v3"),
        ("cosyvoice-v1", "female-1") => Ok("longwan"),
        ("cosyvoice-v1", "male-1") => Ok("longshuo"),
        ("cosyvoice-v1", "narrator") => Ok("longshu"),
        ("cosyvoice-v3-plus" | "cosyvoice-v3-flash" | "cosyvoice-v1", _) => Err(
            AppError::Provider(format!("unsupported CosyVoice voice option {voice_key:?}")),
        ),
        _ => Err(AppError::Provider(format!(
            "unsupported CosyVoice model {model:?}"
        ))),
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
        assert_eq!(
            map_voice_id("female-1", "cosyvoice-v3-flash").unwrap(),
            "longxiaochun_v3"
        );
        assert_eq!(
            map_voice_id("male-1", "cosyvoice-v3-flash").unwrap(),
            "longshu_v3"
        );
        assert_eq!(
            map_voice_id("narrator", "cosyvoice-v3-flash").unwrap(),
            "loongbella_v3"
        );
        assert_eq!(
            map_voice_id("female-1", "cosyvoice-v3-plus").unwrap(),
            "longanhuan"
        );
        assert_eq!(
            map_voice_id("male-1", "cosyvoice-v3-plus").unwrap(),
            "longanyang"
        );
        assert!(map_voice_id("narrator", "cosyvoice-v3-plus").is_err());
        assert_eq!(map_voice_id("female-1", "cosyvoice-v1").unwrap(), "longwan");
        assert_eq!(map_voice_id("male-1", "cosyvoice-v1").unwrap(), "longshuo");
        assert_eq!(map_voice_id("narrator", "cosyvoice-v1").unwrap(), "longshu");
    }

    #[test]
    fn voice_mapping_rejects_unknown_model_or_voice() {
        assert!(map_voice_id("unknown", "cosyvoice-v3-plus").is_err());
        assert!(map_voice_id("female-1", "cosyvoice-v2").is_err());
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
