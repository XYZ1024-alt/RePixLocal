use std::future::Future;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};

use crate::db::Repository;
use crate::errors::{AppError, AppResult};
use crate::providers::http_client::{format_http_error, is_transient_provider_error};
use crate::providers::image_payload::image_data_url;

const SEGMENT_POLL_INTERVAL_SECS: u64 = 10;
const SEGMENT_TIMEOUT_SECS: u64 = 1800;
const SUBMIT_TIMEOUT_SECS: u64 = 120;
const POLL_REQUEST_TIMEOUT_SECS: u64 = 60;
const TRANSIENT_RETRY_ATTEMPTS: usize = 3;
const TRANSIENT_RETRY_BASE_DELAY_MS: u64 = 500;
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
        frame_path: &Path,
        duration_sec: f64,
        motion_prompt: Option<&str>,
    ) -> AppResult<String> {
        let image_url = image_data_url(frame_path).await?;
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
        let url = format!("{base_url}/contents/generations/tasks");
        let api_key = settings.api_key.clone();
        let response = retry_transient(TRANSIENT_RETRY_ATTEMPTS, || {
            let url = url.clone();
            let api_key = api_key.clone();
            let payload = payload.clone();
            async move {
                let client = submit_http_client()?;
                client
                    .post(&url)
                    .header("Authorization", format!("Bearer {api_key}"))
                    .header("Content-Type", "application/json")
                    .json(&payload)
                    .send()
                    .await
                    .map_err(|error| AppError::Provider(format_http_error(&url, &error)))
            }
        })
        .await?;
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
        let url = format!("{base_url}/contents/generations/tasks/{job_id}");
        let api_key = settings.api_key.clone();
        let response = retry_transient(TRANSIENT_RETRY_ATTEMPTS, || {
            let url = url.clone();
            let api_key = api_key.clone();
            async move {
                let client = poll_http_client()?;
                client
                    .get(&url)
                    .header("Authorization", format!("Bearer {api_key}"))
                    .send()
                    .await
                    .map_err(|error| AppError::Provider(format_http_error(&url, &error)))
            }
        })
        .await?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            let label = if status.is_server_error() || status.as_u16() == 429 {
                "Seedance poll transient error"
            } else {
                "Seedance poll error"
            };
            return Err(AppError::Provider(format!("{label} ({status}): {body}")));
        }
        let body: Value = response
            .json()
            .await
            .map_err(|error| AppError::Provider(error.to_string()))?;
        let raw_status = body
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default();
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
            let polled = match self.poll_segment(job_id).await {
                Ok(result) => result,
                Err(AppError::Provider(message)) if is_transient_provider_error(&message) => {
                    if tokio::time::Instant::now() > deadline {
                        return Err(AppError::Provider(format!(
                            "Seedance job {job_id} timed out after {SEGMENT_TIMEOUT_SECS}s (last error: {message})"
                        )));
                    }
                    tracing::warn!(
                        job_id,
                        "Seedance poll network error, retrying in {SEGMENT_POLL_INTERVAL_SECS}s: {message}"
                    );
                    tokio::time::sleep(Duration::from_secs(SEGMENT_POLL_INTERVAL_SECS)).await;
                    continue;
                }
                Err(error) => return Err(error),
            };
            match polled.status {
                SegmentPollStatus::Ready => {
                    return polled.source_url.ok_or_else(|| {
                        AppError::Provider("Seedance returned READY without video URL".into())
                    });
                }
                SegmentPollStatus::Failed => {
                    return Err(AppError::Provider(format!("Seedance job {job_id} failed")));
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

fn segment_text(duration_sec: f64, motion_prompt: Option<&str>) -> String {
    let duration = format!("--dur {}", duration_sec.round() as i64);
    match motion_prompt {
        Some(prompt) if !prompt.trim().is_empty() => format!("{} {duration}", prompt.trim()),
        _ => duration,
    }
}

fn submit_http_client() -> AppResult<reqwest::Client> {
    crate::providers::http_client::build_http_client(SUBMIT_TIMEOUT_SECS)
}

fn poll_http_client() -> AppResult<reqwest::Client> {
    crate::providers::http_client::build_http_client(POLL_REQUEST_TIMEOUT_SECS)
}

async fn retry_transient<T, F, Fut>(attempts: usize, mut operation: F) -> AppResult<T>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = AppResult<T>>,
{
    let mut last_error: Option<AppError> = None;
    for attempt in 0..attempts {
        match operation().await {
            Ok(value) => return Ok(value),
            Err(AppError::Provider(message)) if is_transient_provider_error(&message) => {
                last_error = Some(AppError::Provider(message));
                if attempt + 1 < attempts {
                    let delay_ms = TRANSIENT_RETRY_BASE_DELAY_MS * 2u64.pow(attempt as u32);
                    tracing::warn!(
                        attempt = attempt + 1,
                        max_attempts = attempts,
                        delay_ms,
                        "Seedance request failed with transient network error, retrying"
                    );
                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                }
            }
            Err(error) => return Err(error),
        }
    }
    Err(last_error
        .unwrap_or_else(|| AppError::Provider("Seedance request failed after retries".into())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segment_text_includes_motion_and_duration() {
        assert_eq!(
            segment_text(5.0, Some("slow zoom in")),
            "slow zoom in --dur 5"
        );
        assert_eq!(segment_text(4.2, None), "--dur 4");
    }
}
