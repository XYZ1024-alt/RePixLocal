use std::path::Path;

use reqwest::Client;

use crate::errors::{AppError, AppResult};

pub async fn download_to_file(url: &str, dest: &Path) -> AppResult<()> {
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|error| AppError::Provider(error.to_string()))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| AppError::Provider(error.to_string()))?;
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