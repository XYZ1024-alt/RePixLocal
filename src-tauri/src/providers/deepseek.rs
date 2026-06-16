use async_trait::async_trait;

use crate::errors::{AppError, AppResult};
use crate::providers::{RewriteInput, RewriteProvider, ScenePlan};

#[derive(Debug, Clone)]
pub struct DeepSeekClient;

#[async_trait]
impl RewriteProvider for DeepSeekClient {
    async fn rewrite_script(&self, _input: RewriteInput) -> AppResult<Vec<ScenePlan>> {
        Err(AppError::Provider(
            "DeepSeek API integration is not implemented".into(),
        ))
    }
}
