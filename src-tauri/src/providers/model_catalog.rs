use serde_json::Value;

use crate::errors::{AppError, AppResult};
use crate::providers::http_client::{
    build_http_client, build_http_client_direct, format_http_error,
};
use crate::models::{ProviderListingCredentials, ProviderModelOption};

const DASHSCOPE_MODELS_URL: &str = "https://dashscope.aliyuncs.com/compatible-mode/v1/models";
const SEEDANCE_MODEL_MARKER: &str = "seedance";

pub fn mock_models(provider: &str) -> Vec<ProviderModelOption> {
    match provider.to_uppercase().as_str() {
        "DEEPSEEK" => vec![
            model_option("deepseek-chat", "deepseek-chat"),
            model_option("deepseek-coder", "deepseek-coder"),
        ],
        "QWEN_VL" => vec![
            model_option("qwen-vl-mock", "Qwen-VL Mock"),
            model_option("qwen-vl-test", "Qwen-VL Test"),
        ],
        "TONGYI" => vec![
            model_option("tongyi-mock-1", "Tongyi Mock 1"),
            model_option("tongyi-mock-2", "Tongyi Mock 2"),
        ],
        "SEEDANCE" => vec![
            model_option("seedance-mock-1", "Seedance Mock 1"),
            model_option("seedance-mock-2", "Seedance Mock 2"),
        ],
        _ => Vec::new(),
    }
}

pub async fn fetch_models(
    provider: &str,
    creds: &ProviderListingCredentials,
) -> AppResult<Vec<ProviderModelOption>> {
    match provider.to_uppercase().as_str() {
        "DEEPSEEK" => fetch_deepseek_models(creds).await,
        "QWEN_VL" => {
            fetch_dashscope_models(creds, &["vl", "vision"], "Qwen-VL").await
        }
        "TONGYI" => {
            fetch_dashscope_models(creds, &["wanx", "wan"], "Tongyi image").await
        }
        "SEEDANCE" => fetch_seedance_models(creds).await,
        _ => Err(AppError::Provider(format!("unsupported provider: {provider}"))),
    }
}

pub fn ensure_v1_base_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/v1")
    }
}

pub fn parse_openai_models_response(value: &Value) -> AppResult<Vec<ProviderModelOption>> {
    let data = value
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::Provider("invalid models response: missing data array".into()))?;
    Ok(data
        .iter()
        .filter_map(|entry| {
            let id = entry.get("id")?.as_str()?;
            Some(model_option(id, id))
        })
        .collect())
}

pub fn filter_models_by_keywords(
    models: Vec<ProviderModelOption>,
    keywords: &[&str],
) -> Vec<ProviderModelOption> {
    models
        .into_iter()
        .filter(|model| {
            let id = model.id.to_lowercase();
            keywords.iter().any(|keyword| id.contains(keyword))
        })
        .collect()
}

pub fn is_seedance_model(id: &str, name: &str) -> bool {
    let id = id.to_lowercase();
    let name = name.to_lowercase();
    id.contains(SEEDANCE_MODEL_MARKER) || name.contains(SEEDANCE_MODEL_MARKER)
}

pub fn parse_seedance_models_response(value: &Value) -> AppResult<Vec<ProviderModelOption>> {
    let data = value
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::Provider("invalid models response: missing data array".into()))?;
    let models: Vec<ProviderModelOption> = data
        .iter()
        .filter_map(|entry| {
            let id = entry.get("id")?.as_str()?;
            let name = entry
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(id);
            if is_seedance_model(id, name) {
                Some(model_option(id, name))
            } else {
                None
            }
        })
        .collect();
    if models.is_empty() {
        return Err(AppError::Provider(
            "Ark returned no Seedance models for this key.".into(),
        ));
    }
    Ok(models)
}

async fn fetch_deepseek_models(creds: &ProviderListingCredentials) -> AppResult<Vec<ProviderModelOption>> {
    let base_url = ensure_v1_base_url(&creds.base_url);
    let url = format!("{base_url}/models");
    let value = get_models_json(&url, &creds.api_key).await?;
    parse_openai_models_response(&value)
}

async fn fetch_dashscope_models(
    creds: &ProviderListingCredentials,
    keywords: &[&str],
    label: &str,
) -> AppResult<Vec<ProviderModelOption>> {
    let value = get_models_json(DASHSCOPE_MODELS_URL, &creds.api_key).await?;
    let models = parse_openai_models_response(&value)?;
    let filtered = filter_models_by_keywords(models, keywords);
    if filtered.is_empty() {
        return Err(AppError::Provider(format!(
            "DashScope returned no {label} models for this key."
        )));
    }
    Ok(filtered)
}

async fn fetch_seedance_models(creds: &ProviderListingCredentials) -> AppResult<Vec<ProviderModelOption>> {
    let base_url = creds.base_url.trim().trim_end_matches('/');
    let url = format!("{base_url}/models");
    let value = get_models_json(&url, &creds.api_key).await?;
    parse_seedance_models_response(&value)
}

async fn get_models_json(url: &str, api_key: &str) -> AppResult<Value> {
    let client = if uses_direct_connection(url) {
        build_http_client_direct(30)?
    } else {
        build_http_client(30)?
    };
    let response = client
        .get(url)
        .header("Authorization", format!("Bearer {api_key}"))
        .send()
        .await
        .map_err(|error| AppError::Provider(format_http_error(url, &error)))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::Provider(format!(
            "models request failed ({status}): {body}"
        )));
    }
    response
        .json()
        .await
        .map_err(|error| AppError::Provider(error.to_string()))
}

fn uses_direct_connection(url: &str) -> bool {
    url.contains("aliyuncs.com") || url.contains("volces.com")
}

fn model_option(id: &str, name: &str) -> ProviderModelOption {
    ProviderModelOption {
        id: id.to_string(),
        name: name.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ensure_v1_base_url_appends_suffix() {
        assert_eq!(
            ensure_v1_base_url("https://api.deepseek.com"),
            "https://api.deepseek.com/v1"
        );
        assert_eq!(
            ensure_v1_base_url("https://api.deepseek.com/"),
            "https://api.deepseek.com/v1"
        );
        assert_eq!(
            ensure_v1_base_url("https://api.deepseek.com/v1"),
            "https://api.deepseek.com/v1"
        );
    }

    #[test]
    fn parse_openai_models_response_maps_ids() {
        let value = json!({
            "data": [
                {"id": "deepseek-chat"},
                {"id": "deepseek-reasoner"}
            ]
        });
        let models = parse_openai_models_response(&value).expect("parse models");
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "deepseek-chat");
        assert_eq!(models[0].name, "deepseek-chat");
    }

    #[test]
    fn filter_models_by_keywords_keeps_vl_models() {
        let models = vec![
            model_option("qwen-vl-max", "qwen-vl-max"),
            model_option("qwen-turbo", "qwen-turbo"),
            model_option("qwen-vision-pro", "qwen-vision-pro"),
        ];
        let filtered = filter_models_by_keywords(models, &["vl", "vision"]);
        assert_eq!(filtered.len(), 2);
        assert!(filtered.iter().any(|model| model.id == "qwen-vl-max"));
        assert!(filtered.iter().any(|model| model.id == "qwen-vision-pro"));
    }

    #[test]
    fn filter_models_by_keywords_keeps_wan_models() {
        let models = vec![
            model_option("wan2.1-t2i-turbo", "wan2.1-t2i-turbo"),
            model_option("qwen-turbo", "qwen-turbo"),
            model_option("wanx-v1", "wanx-v1"),
        ];
        let filtered = filter_models_by_keywords(models, &["wanx", "wan"]);
        assert_eq!(filtered.len(), 2);
    }

    #[test]
    fn is_seedance_model_matches_id_or_name() {
        assert!(is_seedance_model("seedance-1.0-pro", "other"));
        assert!(is_seedance_model("other", "Seedance Lite"));
        assert!(!is_seedance_model("doubao-pro", "Doubao Pro"));
    }

    #[test]
    fn parse_seedance_models_response_filters_marker() {
        let value = json!({
            "data": [
                {"id": "doubao-pro", "name": "Doubao Pro"},
                {"id": "seedance-1.0-pro", "name": "Seedance Pro"}
            ]
        });
        let models = parse_seedance_models_response(&value).expect("parse seedance models");
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "seedance-1.0-pro");
    }

    #[test]
    fn parse_seedance_models_response_errors_when_empty() {
        let value = json!({
            "data": [
                {"id": "doubao-pro", "name": "Doubao Pro"}
            ]
        });
        let error = parse_seedance_models_response(&value).expect_err("expected error");
        assert!(error.to_string().contains("no Seedance models"));
    }
}