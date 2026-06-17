use std::collections::HashMap;
use std::path::Path;

use serde_json::{json, Value};

use crate::errors::{AppError, AppResult};
use crate::models::TranscriptSegment;

#[derive(Debug, Clone)]
pub struct SubtitleCue {
    pub start_sec: f64,
    pub end_sec: f64,
    pub text: String,
}

#[derive(Debug, Clone, Default)]
pub struct AssStyle {
    pub font: String,
    pub size: i32,
    pub color: String,
    pub position: String,
    pub aspect_ratio: String,
    pub resolution: String,
}

const DEFAULT_FONT: &str = "Noto Sans";
const DEFAULT_FONT_SIZE: i32 = 32;
const DEFAULT_COLOR: &str = "#FFFFFF";
const DEFAULT_POSITION: &str = "bottom";
const DEFAULT_ASPECT_RATIO: &str = "16:9";
const DEFAULT_RESOLUTION: &str = "1080p";
const HORIZONTAL_MARGIN_RATIO: f64 = 0.08;
const VERTICAL_MARGIN_RATIO: f64 = 0.05;
const MIN_SUBTITLE_MARGIN: i32 = 24;
const MIN_LINE_CHAR_LIMIT: usize = 8;
const OUTLINE_WIDTH: i32 = 2;
const SHADOW_DEPTH: i32 = 1;

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
    let items = value.as_array().ok_or_else(|| {
        AppError::Workflow("subtitle JSON must be an array of segments".into())
    })?;
    items
        .iter()
        .map(|item| {
            Ok(TranscriptSegment {
                start_ms: item
                    .get("startMs")
                    .and_then(Value::as_i64)
                    .unwrap_or(0),
                end_ms: item
                    .get("endMs")
                    .and_then(Value::as_i64)
                    .unwrap_or(0),
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

pub fn ass_style_from_config(config: &Value) -> AssStyle {
    let style = config.get("subtitleStyle").cloned().unwrap_or(Value::Null);
    AssStyle {
        font: style
            .get("font")
            .and_then(Value::as_str)
            .unwrap_or(DEFAULT_FONT)
            .to_string(),
        size: style
            .get("size")
            .and_then(Value::as_i64)
            .unwrap_or(DEFAULT_FONT_SIZE as i64) as i32,
        color: style
            .get("color")
            .and_then(Value::as_str)
            .unwrap_or(DEFAULT_COLOR)
            .to_string(),
        position: style
            .get("position")
            .and_then(Value::as_str)
            .unwrap_or(DEFAULT_POSITION)
            .to_string(),
        aspect_ratio: config
            .get("aspectRatio")
            .and_then(Value::as_str)
            .unwrap_or(DEFAULT_ASPECT_RATIO)
            .to_string(),
        resolution: config
            .get("resolution")
            .and_then(Value::as_str)
            .unwrap_or(DEFAULT_RESOLUTION)
            .to_string(),
    }
}

pub fn cues_from_segments(segments: &[TranscriptSegment]) -> Vec<SubtitleCue> {
    segments
        .iter()
        .filter(|segment| !segment.text.trim().is_empty())
        .map(|segment| SubtitleCue {
            start_sec: segment.start_ms as f64 / 1000.0,
            end_sec: segment.end_ms as f64 / 1000.0,
            text: segment.text.clone(),
        })
        .collect()
}

pub async fn build_ass(
    cues: &[SubtitleCue],
    out_path: &Path,
    style: &AssStyle,
) -> AppResult<()> {
    if let Some(parent) = out_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let (play_res_x, play_res_y) = play_resolution(style);
    let (margin_l, margin_v) = subtitle_margins(play_res_x, play_res_y);
    let char_limit = line_char_limit(play_res_x, margin_l, style.size);
    let align = alignment(&style.position);
    let color = ass_color(&style.color);
    let mut content = build_header(
        &style.font,
        style.size,
        &color,
        align,
        (play_res_x, play_res_y),
        (margin_l, margin_v),
    );
    for cue in cues {
        content.push_str(&dialogue_line(cue, char_limit));
        content.push('\n');
    }
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(content.as_bytes());
    tokio::fs::write(out_path, bytes).await?;
    Ok(())
}

fn play_resolution(style: &AssStyle) -> (i32, i32) {
    let key = (style.aspect_ratio.as_str(), style.resolution.as_str());
    let resolutions: HashMap<(&str, &str), (i32, i32)> = HashMap::from([
        (("16:9", "1080p"), (1920, 1080)),
        (("16:9", "720p"), (1280, 720)),
        (("9:16", "1080p"), (1080, 1920)),
        (("9:16", "720p"), (720, 1280)),
    ]);
    *resolutions
        .get(&key)
        .unwrap_or(&(1920, 1080))
}

fn subtitle_margins(play_res_x: i32, play_res_y: i32) -> (i32, i32) {
    let margin_l = (play_res_x as f64 * HORIZONTAL_MARGIN_RATIO)
        .round()
        .max(MIN_SUBTITLE_MARGIN as f64) as i32;
    let margin_v = (play_res_y as f64 * VERTICAL_MARGIN_RATIO)
        .round()
        .max(MIN_SUBTITLE_MARGIN as f64) as i32;
    (margin_l, margin_v)
}

fn line_char_limit(play_res_x: i32, margin_l: i32, font_size: i32) -> usize {
    let available_width = play_res_x - margin_l * 2;
    let font_size = font_size.max(1) as usize;
    ((available_width as usize) / font_size).max(MIN_LINE_CHAR_LIMIT)
}

fn alignment(position: &str) -> i32 {
    match position {
        "center" => 5,
        "top" => 8,
        _ => 2,
    }
}

fn ass_color(hex_color: &str) -> String {
    let hex = hex_color.trim_start_matches('#');
    if hex.len() != 6 {
        return "&H00FFFFFF".to_string();
    }
    let r = &hex[0..2];
    let g = &hex[2..4];
    let b = &hex[4..6];
    format!("&H00{b}{g}{r}").to_uppercase()
}

fn ass_time(seconds: f64) -> String {
    let seconds = seconds.max(0.0);
    let centiseconds = (seconds * 100.0).round() as i64;
    let hours = centiseconds / 360_000;
    let minutes = (centiseconds % 360_000) / 6_000;
    let secs = (centiseconds % 6_000) / 100;
    let cs = centiseconds % 100;
    format!("{hours}:{minutes:02}:{secs:02}.{cs:02}")
}

fn escape_ass_text(text: &str) -> String {
    text.replace('\n', "\\N")
        .replace('{', "(")
        .replace('}', ")")
}

fn wrap_text(text: &str, char_limit: usize) -> String {
    text.lines()
        .flat_map(|line| wrap_line(line, char_limit))
        .collect::<Vec<_>>()
        .join("\n")
}

fn wrap_line(line: &str, char_limit: usize) -> Vec<String> {
    let mut remaining = line.trim().to_string();
    let mut wrapped = Vec::new();
    while remaining.chars().count() > char_limit {
        let split_at = split_index(&remaining, char_limit);
        wrapped.push(remaining[..split_at].trim_end().to_string());
        remaining = remaining[split_at..].trim_start().to_string();
    }
    if !remaining.is_empty() {
        wrapped.push(remaining);
    }
    if wrapped.is_empty() {
        wrapped.push(String::new());
    }
    wrapped
}

fn split_index(line: &str, char_limit: usize) -> usize {
    if let Some(space_index) = line[..=char_limit].rfind(' ') {
        if space_index >= MIN_LINE_CHAR_LIMIT {
            return space_index;
        }
    }
    line.char_indices()
        .nth(char_limit)
        .map(|(index, _)| index)
        .unwrap_or(line.len())
}

fn build_header(
    font: &str,
    size: i32,
    color: &str,
    align: i32,
    play_res: (i32, i32),
    margins: (i32, i32),
) -> String {
    let (play_res_x, play_res_y) = play_res;
    let (margin_l, margin_v) = margins;
    format!(
        "[Script Info]\n\
         ScriptType: v4.00+\n\
         PlayResX: {play_res_x}\n\
         PlayResY: {play_res_y}\n\
         WrapStyle: 0\n\
         ScaledBorderAndShadow: yes\n\n\
         [V4+ Styles]\n\
         Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, \
         BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, \
         MarginL, MarginR, MarginV, Encoding\n\
         Style: Default,{font},{size},{color},&H00000000,&H64000000,\
         0,0,1,{OUTLINE_WIDTH},{SHADOW_DEPTH},{align},\
         {margin_l},{margin_l},{margin_v},1\n\n\
         [Events]\n\
         Format: Layer, Start, End, Style, Name, MarginL, MarginR, \
         MarginV, Effect, Text\n"
    )
}

fn dialogue_line(cue: &SubtitleCue, char_limit: usize) -> String {
    let text = escape_ass_text(&wrap_text(&cue.text, char_limit));
    format!(
        "Dialogue: 0,{},{},Default,,0,0,0,,{text}",
        ass_time(cue.start_sec),
        ass_time(cue.end_sec)
    )
}

fn format_srt_timestamp(ms: i64) -> String {
    let ms = ms.max(0);
    let hours = ms / 3_600_000;
    let minutes = (ms % 3_600_000) / 60_000;
    let seconds = (ms % 60_000) / 1_000;
    let millis = ms % 1_000;
    format!("{hours:02}:{minutes:02}:{seconds:02},{millis:03}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ass_color_converts_hex_to_bgr() {
        assert_eq!(ass_color("#FF8040"), "&H004080FF");
    }

    #[test]
    fn cues_skip_empty_lines() {
        let cues = cues_from_segments(&[
            TranscriptSegment {
                start_ms: 0,
                end_ms: 1000,
                text: "hello".to_string(),
            },
            TranscriptSegment {
                start_ms: 1000,
                end_ms: 2000,
                text: "   ".to_string(),
            },
        ]);
        assert_eq!(cues.len(), 1);
        assert!((cues[0].start_sec - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn wrap_line_splits_on_spaces() {
        let wrapped = wrap_line("short line", 20);
        assert_eq!(wrapped, vec!["short line"]);
        let long = wrap_line("one two three four five six seven eight", 12);
        assert!(long.len() > 1);
    }

    #[tokio::test]
    async fn build_ass_writes_utf8_bom() {
        let dir = std::env::temp_dir().join(format!("repix-ass-test-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let path = dir.join("subs.ass");
        build_ass(
            &[SubtitleCue {
                start_sec: 0.0,
                end_sec: 1.5,
                text: "Hello".to_string(),
            }],
            &path,
            &AssStyle::default(),
        )
        .await
        .unwrap();
        let bytes = tokio::fs::read(&path).await.unwrap();
        assert_eq!(&bytes[..3], &[0xEF, 0xBB, 0xBF]);
        assert!(String::from_utf8_lossy(&bytes).contains("Dialogue:"));
        let _ = tokio::fs::remove_dir_all(&dir).await;
    }
}