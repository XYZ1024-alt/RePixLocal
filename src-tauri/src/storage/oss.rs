use std::path::Path;
use s3::bucket::Bucket;
use s3::creds::Credentials;
use s3::region::Region;


use crate::config::AppConfig;
use crate::errors::{AppError, AppResult};
use crate::secrets::{decrypt_secret, encrypt_secret};

const OSS_ENDPOINT_MARKER: &str = "aliyuncs.com";
const OSS_REGION: &str = "cn-shanghai";
const DEFAULT_REGION: &str = "us-east-1";
const PRESIGN_EXPIRES_SECS: u32 = 3600;

#[derive(Debug, Clone)]
pub struct OssClient {
    bucket: Bucket,
    bucket_name: String,
    endpoint: String,
    public_endpoint: Option<String>,
    is_oss: bool,
}

impl OssClient {
    pub fn from_config(config: &AppConfig) -> AppResult<Self> {
        let endpoint = config
            .s3_endpoint
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::Config("S3 endpoint is not configured".into()))?;
        let bucket_name = config
            .s3_bucket
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::Config("S3 bucket is not configured".into()))?;
        let access_key = config
            .s3_access_key
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::Config("S3 access key is not configured".into()))?;
        let secret_key = config
            .s3_secret_key_encrypted
            .as_deref()
            .map(decrypt_secret)
            .transpose()?
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| AppError::Config("S3 secret key is not configured".into()))?;

        let is_oss = endpoint.contains(OSS_ENDPOINT_MARKER);
        let region_name = if is_oss {
            OSS_REGION.to_string()
        } else {
            DEFAULT_REGION.to_string()
        };
        let region = Region::Custom {
            region: region_name,
            endpoint: endpoint.trim_end_matches('/').to_string(),
        };
        let credentials = Credentials::new(
            Some(access_key),
            Some(secret_key.trim()),
            None,
            None,
            None,
        )
        .map_err(|error| AppError::Config(error.to_string()))?;
        let mut bucket = *Bucket::new(bucket_name, region, credentials)
            .map_err(|error| AppError::Config(error.to_string()))?;
        if !is_oss {
            bucket.set_path_style();
        }

        Ok(Self {
            bucket,
            bucket_name: bucket_name.to_string(),
            endpoint: endpoint.trim_end_matches('/').to_string(),
            public_endpoint: config
                .s3_public_endpoint
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            is_oss,
        })
    }

    pub async fn put_file(&self, key: &str, path: &Path, content_type: &str) -> AppResult<String> {
        let bytes = tokio::fs::read(path).await.map_err(|error| {
            AppError::Workflow(format!(
                "failed to read file for upload ({}): {error}",
                path.display()
            ))
        })?;
        self.bucket
            .put_object_with_content_type(key, &bytes, content_type)
            .await
            .map_err(|error| AppError::Filesystem(std::io::Error::other(error.to_string())))?;
        Ok(key.to_string())
    }

    pub async fn public_url(&self, key: &str) -> AppResult<String> {
        if self.is_oss {
            if let Some(public_endpoint) = &self.public_endpoint {
                return Ok(public_object_url(public_endpoint, key));
            }
            return Ok(oss_bucket_object_url(&self.endpoint, &self.bucket_name, key));
        }

        let url = self
            .bucket
            .presign_get(key, PRESIGN_EXPIRES_SECS, None)
            .await
            .map_err(|error| AppError::Config(error.to_string()))?;
        Ok(url)
    }
}

pub fn merge_secret_on_save(config: &mut AppConfig) -> AppResult<()> {
    if let Some(secret) = config.s3_secret_key.take() {
        let trimmed = secret.trim();
        if !trimmed.is_empty() {
            config.s3_secret_key_encrypted = Some(encrypt_secret(trimmed)?);
        }
    }
    Ok(())
}

pub fn sanitize_config_for_ui(mut config: AppConfig) -> AppConfig {
    config.s3_secret_decrypt_failed = config
        .s3_secret_key_encrypted
        .as_deref()
        .is_some_and(|encrypted| decrypt_secret(encrypted).is_err());
    config.s3_secret_configured =
        config.s3_secret_key_encrypted.is_some() && !config.s3_secret_decrypt_failed;
    config.s3_secret_key_encrypted = None;
    config.s3_secret_key = None;
    config
}

fn public_object_url(endpoint: &str, key: &str) -> String {
    format!(
        "{}/{}",
        endpoint.trim_end_matches('/'),
        percent_encode_path(key)
    )
}

fn oss_bucket_object_url(endpoint: &str, bucket: &str, key: &str) -> String {
    let host = endpoint
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/');
    public_object_url(&format!("https://{bucket}.{host}"), key)
}

fn percent_encode_path(key: &str) -> String {
    key.split('/')
        .map(encode_path_segment)
        .collect::<Vec<_>>()
        .join("/")
}

fn encode_path_segment(segment: &str) -> String {
    let mut encoded = String::new();
    for byte in segment.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::{encode_path_segment, percent_encode_path, public_object_url};

    #[test]
    fn percent_encode_path_preserves_slashes() {
        assert_eq!(
            percent_encode_path("tasks/id/frame.png"),
            "tasks/id/frame.png"
        );
    }

    #[test]
    fn encode_path_segment_escapes_spaces() {
        assert_eq!(encode_path_segment("hello world"), "hello%20world");
    }

    #[test]
    fn public_object_url_joins_endpoint_and_key() {
        assert_eq!(
            public_object_url("https://oss.example.com", "tasks/a.png"),
            "https://oss.example.com/tasks/a.png"
        );
    }
}