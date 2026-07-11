use std::path::Path;

use tokio::io::AsyncWriteExt;

use crate::errors::{AppError, AppResult};
use crate::providers::http_client::{build_http_client, format_http_error};

pub async fn download_to_file(url: &str, dest: &Path) -> AppResult<()> {
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    if dest.exists() {
        return Err(AppError::Provider(format!(
            "download destination already exists: {}",
            dest.display()
        )));
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
    let expected_bytes = response.content_length();
    let temp_path = download_temp_path(dest)?;
    let result = write_response(response, &temp_path, expected_bytes).await;
    let result = match result {
        Ok(()) => tokio::fs::rename(&temp_path, dest).await.map_err(|error| {
            AppError::Provider(format!("failed to finalize download file: {error}"))
        }),
        Err(error) => Err(error),
    };

    if result.is_err() {
        let _ = tokio::fs::remove_file(&temp_path).await;
    }
    result
}

async fn write_response(
    mut response: reqwest::Response,
    temp_path: &Path,
    expected_bytes: Option<u64>,
) -> AppResult<()> {
    let mut file = tokio::fs::File::create(temp_path)
        .await
        .map_err(|error| AppError::Provider(format!("failed to create download file: {error}")))?;
    let mut downloaded_bytes = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| AppError::Provider(error.to_string()))?
    {
        file.write_all(&chunk).await.map_err(|error| {
            AppError::Provider(format!("failed to write download chunk: {error}"))
        })?;
        downloaded_bytes += chunk.len() as u64;
    }
    validate_download_size(downloaded_bytes, expected_bytes)?;
    file.flush()
        .await
        .map_err(|error| AppError::Provider(format!("failed to flush download file: {error}")))?;
    file.sync_all()
        .await
        .map_err(|error| AppError::Provider(format!("failed to sync download file: {error}")))
}

fn download_temp_path(dest: &Path) -> AppResult<std::path::PathBuf> {
    let parent = dest
        .parent()
        .ok_or_else(|| AppError::Provider("download destination has no parent".into()))?;
    let file_name = dest
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("download");
    Ok(parent.join(format!(".{file_name}-{}.download", uuid::Uuid::new_v4())))
}

fn validate_download_size(downloaded_bytes: u64, expected_bytes: Option<u64>) -> AppResult<()> {
    if downloaded_bytes == 0 {
        return Err(AppError::Provider("download returned an empty body".into()));
    }
    if let Some(expected) = expected_bytes {
        if expected != downloaded_bytes {
            return Err(AppError::Provider(format!(
                "download size mismatch: expected {expected} bytes, received {downloaded_bytes}"
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    use super::*;

    #[tokio::test]
    async fn download_is_finalized_only_after_complete_response() {
        let url = serve_once(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\ndata");
        let dir = test_dir();
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let dest = dir.join("asset.bin");

        download_to_file(&url, &dest).await.unwrap();

        assert_eq!(tokio::fs::read(&dest).await.unwrap(), b"data");
        assert!(download_temp_files(&dir).is_empty());
        let _ = tokio::fs::remove_dir_all(dir).await;
    }

    #[tokio::test]
    async fn interrupted_download_leaves_no_destination_or_temp_file() {
        let url = serve_once(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nshort");
        let dir = test_dir();
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let dest = dir.join("asset.bin");

        let error = download_to_file(&url, &dest).await.unwrap_err();

        assert!(error.to_string().contains("body") || error.to_string().contains("size"));
        assert!(!dest.exists());
        assert!(download_temp_files(&dir).is_empty());
        let _ = tokio::fs::remove_dir_all(dir).await;
    }

    fn serve_once(response: &'static [u8]) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 1024];
            let _ = stream.read(&mut request);
            stream.write_all(response).unwrap();
        });
        format!("http://{address}/asset")
    }

    fn test_dir() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("repix-download-test-{}", uuid::Uuid::new_v4()))
    }

    fn download_temp_files(dir: &Path) -> Vec<std::path::PathBuf> {
        std::fs::read_dir(dir)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("download"))
            .collect()
    }
}
