use std::time::Duration;

use reqwest::Client;

use crate::errors::{AppError, AppResult};

/// HTTP client that always connects directly (no proxy).
pub fn build_http_client(timeout_secs: u64) -> AppResult<Client> {
    Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .connect_timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(10))
        .no_proxy()
        .build()
        .map_err(|error| AppError::Provider(error.to_string()))
}

pub fn is_transient_provider_error(message: &str) -> bool {
    const MARKERS: &[&str] = &[
        "connection failed",
        "request timed out",
        "operation timed out",
        "connection reset",
        "connection closed",
        "broken pipe",
        "dns error",
        "error sending request",
        "transient error",
    ];
    let lower = message.to_ascii_lowercase();
    MARKERS.iter().any(|marker| lower.contains(marker))
}

pub fn format_http_error(context: &str, error: &reqwest::Error) -> String {
    let mut parts = vec![format!("{context}: {error}")];
    if error.is_connect() {
        parts.push("connection failed — check network or firewall".to_string());
    }
    if error.is_timeout() {
        parts.push("request timed out".to_string());
    }
    if let Some(status) = error.status() {
        parts.push(format!("HTTP status {status}"));
    }
    parts.join("; ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_http_client_succeeds() {
        build_http_client(5).expect("client should build");
    }

    #[test]
    fn detects_transient_provider_errors() {
        assert!(is_transient_provider_error(
            "https://example.com: error sending request; connection failed; request timed out"
        ));
        assert!(!is_transient_provider_error(
            "Seedance poll error (401): unauthorized"
        ));
    }
}
