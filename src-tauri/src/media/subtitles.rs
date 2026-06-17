use serde_json::{json, Value};

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

pub fn segments_to_srt(segments: &[TranscriptSegment]) -> String {
    segments
        .iter()
        .enumerate()
        .map(|(index, segment)| {
            format!(
                "{}\n{} --> {}\n{}\n",
                index + 1,
                format_srt_timestamp(segment.start_ms),
                format_srt_timestamp(segment.end_ms),
                segment.text.trim()
            )
        })
        .collect()
}

fn format_srt_timestamp(ms: i64) -> String {
    let ms = ms.max(0);
    let hours = ms / 3_600_000;
    let minutes = (ms % 3_600_000) / 60_000;
    let seconds = (ms % 60_000) / 1_000;
    let millis = ms % 1_000;
    format!("{hours:02}:{minutes:02}:{seconds:02},{millis:03}")
}