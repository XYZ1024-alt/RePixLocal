use async_trait::async_trait;

use crate::errors::{AppError, AppResult};
use crate::providers::{GeneratedVideo, SegmentGenerationInput, VideoProvider};

#[derive(Debug, Clone)]
pub struct SeedanceClient;

#[async_trait]
impl VideoProvider for SeedanceClient {
    async fn generate_segment(&self, _input: SegmentGenerationInput) -> AppResult<GeneratedVideo> {
        Err(AppError::Provider(
            "Seedance video API integration is not implemented".into(),
        ))
    }
}
