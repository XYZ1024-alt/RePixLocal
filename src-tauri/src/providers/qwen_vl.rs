use async_trait::async_trait;

use crate::errors::{AppError, AppResult};
use crate::providers::{AnalyzeFramesInput, AnalyzeFramesOutput, VisionProvider};

#[derive(Debug, Clone)]
pub struct QwenVlClient;

#[async_trait]
impl VisionProvider for QwenVlClient {
    async fn analyze_frames(&self, _input: AnalyzeFramesInput) -> AppResult<AnalyzeFramesOutput> {
        Err(AppError::Provider(
            "Qwen-VL API integration is not implemented".into(),
        ))
    }
}
