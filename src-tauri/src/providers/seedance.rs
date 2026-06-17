use std::net::IpAddr;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use reqwest::Client;
use serde_json::{json, Value};


use crate::db::Repository;
use crate::errors::{AppError, AppResult};
use crate::storage::oss::OssClient;

const SEGMENT_POLL_INTERVAL_SECS: u64 = 10;
const SEGMENT_TIMEOUT_SECS: u64 = 1800;
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SegmentPollStatus {
    Pending,
    Ready,
    Failed,
}

#[derive(Debug, Clone)]
pub struct SegmentPollResult {
    pub status: SegmentPollStatus,
    pub source_url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SeedanceClient {
    repo: Arc<Repository>,
}

impl SeedanceClient {
    pub fn new(repo: Arc<Repository>) -> Self {
        Self { repo }
    }

    pub async fn submit_segment(
        &self,
        oss: &OssClient,
        frame_key: &str,
        frame_path: &Path,
        duration_sec: f64,
        motion_prompt: Option<&str>,
    ) -> AppResult<String> {
        oss.put_file(frame_key, frame_path, "image/png").await?;
        let image_url = provider_readable_image_url(oss, frame_key).await?;
        let settings = self.repo.get_provider_settings("SEEDANCE").await?;
        let base_url = settings.base_url.trim_end_matches('/');
        let text = segment_text(duration_sec, motion_prompt);
        let payload = json!({
            "model": settings.model,
            "generate_audio": false,
            "content": [
                { "type": "text", "text": text },
                { "type": "image_url", "image_url": { "url": image_url } }
            ]
        });
        let client = http_client()?;
        let response = client
            .post(format!("{base_url}/contents/generations/tasks"))
            .header("Authorization", format!("Bearer {}", settings.api_key))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(|error| AppError::Provider(error.to_string()))?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::Provider(format!(
                "Seedance submit error ({status}): {body}"
            )));
        }
        let body: Value = response
            .json()
            .await
            .map_err(|error| AppError::Provider(error.to_string()))?;
        body.get("id")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| AppError::Provider("Seedance submit returned no job id".into()))
    }

    pub async fn poll_segment(&self, job_id: &str) -> AppResult<SegmentPollResult> {
        let settings = self.repo.get_provider_settings("SEEDANCE").await?;
        let base_url = settings.base_url.trim_end_matches('/');
        let client = http_client()?;
        let response = client
            .get(format!("{base_url}/contents/generations/tasks/{job_id}"))
            .header("Authorization", format!("Bearer {}", settings.api_key))
            .send()
            .await
            .map_err(|error| AppError::Provider(error.to_string()))?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::Provider(format!(
                "Seedance poll error ({status}): {body}"
            )));
        }
        let body: Value = response
            .json()
            .await
            .map_err(|error| AppError::Provider(error.to_string()))?;
        let raw_status = body.get("status").and_then(Value::as_str).unwrap_or_default();
        let status = match raw_status {
            "queued" | "running" => SegmentPollStatus::Pending,
            "succeeded" => SegmentPollStatus::Ready,
            "failed" | "cancelled" => SegmentPollStatus::Failed,
            _ => SegmentPollStatus::Pending,
        };
        let source_url = if status == SegmentPollStatus::Ready {
            body.pointer("/content/video_url")
                .and_then(Value::as_str)
                .map(str::to_string)
        } else {
            None
        };
        Ok(SegmentPollResult { status, source_url })
    }

    pub async fn wait_for_segment(&self, job_id: &str) -> AppResult<String> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(SEGMENT_TIMEOUT_SECS);
        loop {
            let polled = self.poll_segment(job_id).await?;
            match polled.status {
                SegmentPollStatus::Ready => {
                    return polled.source_url.ok_or_else(|| {
                        AppError::Provider("Seedance returned READY without video URL".into())
                    });
                }
                SegmentPollStatus::Failed => {
                    return Err(AppError::Provider(format!(
                        "Seedance job {job_id} failed"
                    )));
                }
                SegmentPollStatus::Pending => {
                    if tokio::time::Instant::now() > deadline {
                        return Err(AppError::Provider(format!(
                            "Seedance job {job_id} timed out after {SEGMENT_TIMEOUT_SECS}s"
                        )));
                    }
                    tokio::time::sleep(Duration::from_secs(SEGMENT_POLL_INTERVAL_SECS)).await;
                }
            }
        }
    }
}

async fn provider_readable_image_url(oss: &OssClient, frame_key: &str) -> AppResult<String> {
    let url = oss.public_url(frame_key).await?;
    validate_provider_readable_url(&url)?;
    Ok(url)
}

fn validate_provider_readable_url(url: &str) -> AppResult<()> {
    let host = extract_url_host(url).ok_or_else(|| {
        AppError::Provider(format!("Seedance image URL is not an HTTP URL: {url}"))
    })?;
    if is_private_host(host) {
        return Err(AppError::Provider(
            "Seedance image URL points to local/private object storage. \
             Configure s3_public_endpoint to a provider-readable bucket URL."
                .into(),
        ));
    }
    Ok(())
}

fn extract_url_host(url: &str) -> Option<&str> {
    let without_scheme = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    let host = without_scheme.split('/').next()?.split(':').next()?;
    if host.is_empty() {
        None
    } else {
        Some(host)
    }
}

fn is_private_host(hostname: &str) -> bool {
    let normalized = hostname.trim_matches(&['[', ']'][..]).to_lowercase();
    if matches!(
        normalized.as_str(),
        "localhost" | "host.docker.internal"
    ) || normalized.ends_with(".local")
    {
        return true;
    }
    if let Ok(address) = normalized.parse::<IpAddr>() {
        return match address {
            IpAddr::V4(ipv4) => {
                ipv4.is_loopback()
                    || ipv4.is_private()
                    || ipv4.is_unspecified()
                    || ipv4.is_multicast()
            }
            IpAddr::V6(ipv6) => {
                ipv6.is_loopback()
                    || ipv6.is_unspecified()
                    || ipv6.is_multicast()
            }
        };
    }
    !normalized.contains('.')
}

fn segment_text(duration_sec: f64, motion_prompt: Option<&str>) -> String {
    let duration = format!("--dur {}", duration_sec.round() as i64);
    match motion_prompt {
        Some(prompt) if !prompt.trim().is_empty() => format!("{} {duration}", prompt.trim()),
        _ => duration,
    }
}

fn http_client() -> AppResult<Client> {
    Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| AppError::Provider(error.to_string()))
}