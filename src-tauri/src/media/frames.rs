use crate::errors::{AppError, AppResult};

pub fn not_implemented() -> AppResult<()> {
    Err(AppError::Tool(
        "keyframe extraction is not implemented yet".into(),
    ))
}
