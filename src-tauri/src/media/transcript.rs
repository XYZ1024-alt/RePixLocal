use std::path::Path;

use serde_json::{json, Value};

use crate::errors::{AppError, AppResult};
use crate::models::TranscriptSegment;

pub fn segments_to_json(segments: &[TranscriptSegment]) -> Value {
    Value::Array(
        segments
            .iter()
            .map(|segment| {
                json!({
                    "startMs": segment.start_ms,
                    "endMs": segment.end_ms,
                    "text": segment.text,
                })
            })
            .collect(),
    )
}

pub async fn read_segments_from_json(path: &Path) -> AppResult<Vec<TranscriptSegment>> {
    let bytes = tokio::fs::read(path).await?;
    let value: Value = serde_json::from_slice(&bytes)?;
    segments_from_json(&value)
}

pub fn segments_from_json(value: &Value) -> AppResult<Vec<TranscriptSegment>> {
    let items = value
        .as_array()
        .ok_or_else(|| AppError::Workflow("transcript JSON must be an array of segments".into()))?;
    items
        .iter()
        .map(|item| {
            Ok(TranscriptSegment {
                start_ms: item.get("startMs").and_then(Value::as_i64).unwrap_or(0),
                end_ms: item.get("endMs").and_then(Value::as_i64).unwrap_or(0),
                text: item
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            })
        })
        .collect()
}

pub fn transcript_text(segments: &[TranscriptSegment]) -> String {
    segments
        .iter()
        .map(|segment| segment.text.trim())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}
