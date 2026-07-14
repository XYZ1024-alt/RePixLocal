use serde_json::Value;

use crate::errors::{AppError, AppResult};
use crate::models::VideoModelCapabilities;

const SEEDANCE_PROVIDER: &str = "SEEDANCE";
const DEFAULT_HIGH_RESOLUTION: &str = "1080p";
const DEFAULT_STANDARD_RESOLUTION: &str = "720p";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VideoGenerationSelection {
    pub provider: String,
    pub model: String,
    pub resolution: String,
}

pub fn capabilities_for(provider: &str, model: &str) -> Option<VideoModelCapabilities> {
    if !provider.eq_ignore_ascii_case(SEEDANCE_PROVIDER) {
        return None;
    }

    let model = normalize_model_id(model);
    if model == "seedance-mock-1" || model.contains("seedance-2-0") {
        return Some(capabilities(&["480p", "720p"], DEFAULT_STANDARD_RESOLUTION));
    }
    if model == "seedance-mock-2"
        || model.contains("seedance-1-5-pro")
        || model.contains("seedance-1-0-pro")
    {
        return Some(capabilities(
            &["480p", "720p", "1080p"],
            DEFAULT_HIGH_RESOLUTION,
        ));
    }
    if model.contains("seedance-1-0-lite-t2v") {
        return None;
    }
    if model.contains("seedance-1-0-lite") {
        return Some(capabilities(&["480p", "720p"], DEFAULT_STANDARD_RESOLUTION));
    }
    None
}

pub fn selection_from_config(config: &Value) -> AppResult<VideoGenerationSelection> {
    let provider = required_config_string(config, "videoProvider")?;
    let model = required_config_string(config, "videoModel")?;
    let resolution = required_config_string(config, "resolution")?;
    validate_selection(&provider, &model, &resolution)?;
    Ok(VideoGenerationSelection {
        provider,
        model,
        resolution,
    })
}

pub fn validate_selection(provider: &str, model: &str, resolution: &str) -> AppResult<()> {
    let capabilities = capabilities_for(provider, model).ok_or_else(|| {
        AppError::Provider(format!(
            "video capabilities are not defined for provider {provider} model {model}"
        ))
    })?;
    if capabilities
        .resolutions
        .iter()
        .any(|supported| supported == resolution)
    {
        return Ok(());
    }
    Err(AppError::Provider(format!(
        "resolution {resolution} is not supported by {provider} model {model}; supported resolutions: {}",
        capabilities.resolutions.join(", ")
    )))
}

fn capabilities(resolutions: &[&str], default_resolution: &str) -> VideoModelCapabilities {
    VideoModelCapabilities {
        resolutions: resolutions
            .iter()
            .map(|resolution| (*resolution).to_string())
            .collect(),
        default_resolution: default_resolution.to_string(),
    }
}

fn normalize_model_id(model: &str) -> String {
    let normalized = model.trim().to_ascii_lowercase().replace(['.', '_'], "-");
    let Some((prefix, suffix)) = normalized.rsplit_once('-') else {
        return normalized;
    };
    if suffix.len() == 6 && suffix.bytes().all(|byte| byte.is_ascii_digit()) {
        prefix.to_string()
    } else {
        normalized
    }
}

fn required_config_string(config: &Value, key: &str) -> AppResult<String> {
    config
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| AppError::Workflow(format!("{key} is required")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_seedance_model_families_to_distinct_resolutions() {
        let lite = capabilities_for("SEEDANCE", "doubao-seedance-1-0-lite-i2v-250428")
            .expect("lite capabilities");
        let pro = capabilities_for("SEEDANCE", "doubao-seedance-1.5-pro-251215")
            .expect("pro capabilities");
        let v2 =
            capabilities_for("SEEDANCE", "doubao-seedance-2-0-260128").expect("2.0 capabilities");

        assert_eq!(lite.resolutions, ["480p", "720p"]);
        assert_eq!(lite.default_resolution, "720p");
        assert_eq!(pro.resolutions, ["480p", "720p", "1080p"]);
        assert_eq!(pro.default_resolution, "1080p");
        assert_eq!(v2.resolutions, ["480p", "720p"]);
        assert!(capabilities_for("SEEDANCE", "doubao-seedance-1-0-lite-t2v-250428").is_none());
    }

    #[test]
    fn rejects_unknown_models_and_unsupported_resolutions() {
        let unknown =
            validate_selection("SEEDANCE", "seedance-future", "720p").expect_err("unknown model");
        assert!(unknown.to_string().contains("capabilities are not defined"));

        let unsupported =
            validate_selection("SEEDANCE", "doubao-seedance-1-0-lite-i2v-250428", "1080p")
                .expect_err("unsupported resolution");
        assert!(unsupported
            .to_string()
            .contains("supported resolutions: 480p, 720p"));
    }

    #[test]
    fn reads_and_validates_task_selection() {
        let selection = selection_from_config(&serde_json::json!({
            "videoProvider": "SEEDANCE",
            "videoModel": "doubao-seedance-1-0-pro-250528",
            "resolution": "1080p"
        }))
        .expect("valid selection");

        assert_eq!(selection.provider, "SEEDANCE");
        assert_eq!(selection.model, "doubao-seedance-1-0-pro-250528");
        assert_eq!(selection.resolution, "1080p");
    }
}
