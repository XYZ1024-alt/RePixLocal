use serde_json::Value;

use crate::errors::{AppError, AppResult};

pub fn parse_json_payload(content: &str) -> AppResult<Value> {
    let trimmed = strip_code_fence(content.trim());
    serde_json::from_str(trimmed).map_err(|error| {
        AppError::Provider(format!("provider returned invalid JSON: {error}"))
    })
}

fn strip_code_fence(content: &str) -> &str {
    let Some(rest) = content.strip_prefix("```") else {
        return content;
    };
    let rest = rest
        .strip_prefix("json")
        .or_else(|| rest.strip_prefix("JSON"))
        .unwrap_or(rest);
    let rest = rest.trim_start_matches('\n');
    rest.strip_suffix("```")
        .map(str::trim)
        .unwrap_or(rest)
}