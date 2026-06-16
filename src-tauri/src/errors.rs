use thiserror::Error;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("configuration error: {0}")]
    Config(String),
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("filesystem error: {0}")]
    Filesystem(#[from] std::io::Error),
    #[error("provider error: {0}")]
    Provider(String),
    #[error("workflow error: {0}")]
    Workflow(String),
    #[error("external tool error: {0}")]
    Tool(String),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

pub fn command_error(error: AppError) -> String {
    error.to_string()
}
