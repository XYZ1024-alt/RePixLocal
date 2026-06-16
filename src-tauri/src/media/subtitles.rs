use crate::errors::{AppError, AppResult};

pub fn not_implemented() -> AppResult<()> {
    Err(AppError::Tool(
        "subtitle generation is not implemented yet".into(),
    ))
}
