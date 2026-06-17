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

pub fn stage_event_name(stage: &StageType) -> String {
    match stage {
        StageType::TranscriptExtraction => "TRANSCRIPT_EXTRACTION",
        StageType::ScriptRewrite => "SCRIPT_REWRITE",
        StageType::StoryboardGeneration => "STORYBOARD_GENERATION",
        StageType::SegmentGeneration => "SEGMENT_GENERATION",
        StageType::FinalRender => "FINAL_RENDER",
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordered_stages_has_five_entries() {
        assert_eq!(ordered_stages().len(), 5);
    }

    #[test]
    fn stage_event_names_are_upper_snake() {
        assert_eq!(
            stage_event_name(&StageType::FinalRender),
            "FINAL_RENDER"
        );
    }
}
