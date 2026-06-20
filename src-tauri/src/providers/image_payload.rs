use std::path::Path;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;

use crate::errors::{AppError, AppResult};

pub async fn image_data_url(path: &Path) -> AppResult<String> {
    let bytes = tokio::fs::read(path).await.map_err(|error| {
        AppError::Workflow(format!(
            "failed to read image for upload ({}): {error}",
            path.display()
        ))
    })?;
    let image_b64 = STANDARD.encode(bytes);
    Ok(format!("data:image/png;base64,{image_b64}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn image_data_url_prefixes_png_base64() {
        let path = std::env::temp_dir().join(format!(
            "repix-image-payload-{}.png",
            std::process::id()
        ));
        tokio::fs::write(&path, b"fake-png-bytes")
            .await
            .expect("write temp file");
        let url = image_data_url(&path).await.expect("encode image");
        let _ = tokio::fs::remove_file(&path).await;
        assert!(url.starts_with("data:image/png;base64,"));
        assert!(url.len() > "data:image/png;base64,".len());
    }
}