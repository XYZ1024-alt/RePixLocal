use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::errors::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyzeFramesInput {
    pub task_id: String,
    pub frame_paths: Vec<String>,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyzeFramesOutput {
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewriteInput {
    pub task_id: String,
    pub transcript: String,
    pub style: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScenePlan {
    pub scene_index: i32,
    pub script: String,
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageGenerationInput {
    pub task_id: String,
    pub scene: ScenePlan,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedImage {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentGenerationInput {
    pub task_id: String,
    pub image_path: String,
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedVideo {
    pub path: String,
}

#[async_trait]
pub trait VisionProvider: Send + Sync {
    async fn analyze_frames(&self, input: AnalyzeFramesInput) -> AppResult<AnalyzeFramesOutput>;
}

#[async_trait]
pub trait RewriteProvider: Send + Sync {
    async fn rewrite_script(&self, input: RewriteInput) -> AppResult<Vec<ScenePlan>>;
}

#[async_trait]
pub trait ImageProvider: Send + Sync {
    async fn generate_frame(&self, input: ImageGenerationInput) -> AppResult<GeneratedImage>;
}

#[async_trait]
pub trait VideoProvider: Send + Sync {
    async fn generate_segment(&self, input: SegmentGenerationInput) -> AppResult<GeneratedVideo>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub provider: String,
    pub base_url: String,
    pub model: String,
}

pub fn validate_provider_config(config: &ProviderConfig) -> AppResult<()> {
    if config.provider.trim().is_empty() {
        return Err(AppError::Provider("provider is required".into()));
    }
    if config.base_url.trim().is_empty() {
        return Err(AppError::Provider("provider base_url is required".into()));
    }
    if config.model.trim().is_empty() {
        return Err(AppError::Provider("provider model is required".into()));
    }
    Ok(())
}

pub mod catalog;
pub mod deepseek;
pub mod qwen_vl;
pub mod seedance;
pub mod tongyi;
