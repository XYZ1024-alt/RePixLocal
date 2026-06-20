use std::path::Path;

use crate::errors::{AppError, AppResult};
use crate::providers::http_client::{build_http_client, format_http_error};

pub async fn download_to_file(url: &str, dest: &Path) -> AppResult<()> {
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let client = build_http_client(300)?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| AppError::Provider(format_http_error(url, &error)))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::Provider(format!(
            "download failed ({status}): {body}"
        )));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| AppError::Provider(error.to_string()))?;
    tokio::fs::write(dest, bytes).await?;
    Ok(())
}
