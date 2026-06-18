use crate::models::{StageType, WorkflowTaskType};

pub fn ordered_stages(task_type: WorkflowTaskType) -> Vec<StageType> {
    match task_type {
        WorkflowTaskType::Replicate => vec![
            StageType::TranscriptExtraction,
            StageType::ScriptRewrite,
            StageType::StoryboardGeneration,
            StageType::TtsSynthesis,
            StageType::SegmentGeneration,
            StageType::FinalRender,
        ],
        WorkflowTaskType::ImageToVideo => vec![
            StageType::ScriptPlanning,
            StageType::TtsSynthesis,
            StageType::SegmentGeneration,
            StageType::FinalRender,
        ],
    }
}

pub fn stage_event_name(stage: &StageType) -> String {
    match stage {
        StageType::TranscriptExtraction => "TRANSCRIPT_EXTRACTION",
        StageType::ScriptRewrite => "SCRIPT_REWRITE",
        StageType::ScriptPlanning => "SCRIPT_PLANNING",
        StageType::StoryboardGeneration => "STORYBOARD_GENERATION",
        StageType::TtsSynthesis => "TTS_SYNTHESIS",
        StageType::SegmentGeneration => "SEGMENT_GENERATION",
        StageType::FinalRender => "FINAL_RENDER",
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replicate_has_six_stages() {
        assert_eq!(ordered_stages(WorkflowTaskType::Replicate).len(), 6);
    }

    #[test]
    fn image_to_video_has_four_stages() {
        assert_eq!(ordered_stages(WorkflowTaskType::ImageToVideo).len(), 4);
    }

    #[test]
    fn stage_event_names_are_upper_snake() {
        assert_eq!(
            stage_event_name(&StageType::TtsSynthesis),
            "TTS_SYNTHESIS"
        );
    }
}