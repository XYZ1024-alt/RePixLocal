use crate::models::StageType;

pub fn ordered_stages() -> Vec<StageType> {
    vec![
        StageType::TranscriptExtraction,
        StageType::ScriptRewrite,
        StageType::StoryboardGeneration,
        StageType::SegmentGeneration,
        StageType::FinalRender,
    ]
}
