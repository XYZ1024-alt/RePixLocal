use async_trait::async_trait;

use crate::errors::{AppError, AppResult};
use crate::providers::{GeneratedImage, ImageGenerationInput, ImageProvider};

#[derive(Debug, Clone)]
pub struct TongyiClient;

#[async_trait]
impl ImageProvider for TongyiClient {
    async fn generate_frame(&self, _input: ImageGenerationInput) -> AppResult<GeneratedImage> {
        Err(AppError::Provider(
            "Tongyi image API integration is not implemented".into(),
        ))
    }
}
