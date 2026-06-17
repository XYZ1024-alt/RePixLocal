use std::time::Duration;

use reqwest::Client;

use crate::errors::{AppError, AppResult};

/// HTTP client that respects `HTTPS_PROXY` / system proxy (for overseas APIs).
pub fn build_http_client(timeout_secs: u64) -> AppResult<Client> {
    build_http_client_inner(timeout_secs, true)
}

/// HTTP client that bypasses all proxies (for domestic APIs such as DashScope / Volcengine).
pub fn build_http_client_direct(timeout_secs: u64) -> AppResult<Client> {
    build_http_client_inner(timeout_secs, false)
}

fn build_http_client_inner(timeout_secs: u64, use_proxy: bool) -> AppResult<Client> {
    let mut builder = Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .connect_timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(10));

    if use_proxy {
        if let Some(proxy_url) = proxy_from_env() {
            let mut proxy = reqwest::Proxy::all(&proxy_url).map_err(|error| {
                AppError::Provider(format!("invalid proxy URL ({proxy_url}): {error}"))
            })?;
            if let Some(no_proxy) = merged_no_proxy() {
                proxy = proxy.no_proxy(Some(no_proxy));
            }
            builder = builder.proxy(proxy);
        }
    } else {
        builder = builder.no_proxy();
    }

    builder
        .build()
        .map_err(|error| AppError::Provider(error.to_string()))
}

pub fn format_http_error(context: &str, error: &reqwest::Error) -> String {
    let mut parts = vec![format!("{context}: {error}")];
    if error.is_connect() {
        parts.push(
            "connection failed — check network, firewall, or configure HTTPS_PROXY/HTTP_PROXY"
                .to_string(),
        );
    }
    if error.is_timeout() {
        parts.push("request timed out".to_string());
    }
    if let Some(status) = error.status() {
        parts.push(format!("HTTP status {status}"));
    }
    if context.contains("dashscope.aliyuncs.com") || context.contains("volces.com") {
        parts.push(
            "domestic API endpoints should connect directly; if HTTPS_PROXY is set, add \
             .aliyuncs.com and .volces.com to NO_PROXY"
                .to_string(),
        );
    }
    parts.join("; ")
}

fn proxy_from_env() -> Option<String> {
    const KEYS: [&str; 6] = [
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "ALL_PROXY",
        "all_proxy",
    ];
    KEYS.into_iter()
        .find_map(|key| std::env::var(key).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn merged_no_proxy() -> Option<reqwest::NoProxy> {
    const DEFAULT_BYPASS: [&str; 5] = [
        "localhost",
        "127.0.0.1",
        ".aliyuncs.com",
        ".alibaba.com",
        ".volces.com",
    ];
    let mut entries: Vec<String> = DEFAULT_BYPASS.iter().map(|value| (*value).to_string()).collect();
    const ENV_KEYS: [&str; 2] = ["NO_PROXY", "no_proxy"];
    for key in ENV_KEYS {
        if let Ok(value) = std::env::var(key) {
            for part in value.split(',') {
                let trimmed = part.trim();
                if !trimmed.is_empty() && !entries.iter().any(|entry| entry == trimmed) {
                    entries.push(trimmed.to_string());
                }
            }
        }
    }
    reqwest::NoProxy::from_string(&entries.join(","))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_http_client_succeeds_without_proxy() {
        build_http_client(5).expect("client should build");
        build_http_client_direct(5).expect("direct client should build");
    }

    #[test]
    fn merged_no_proxy_parses_domestic_bypass_list() {
        assert!(merged_no_proxy().is_some());
    }
}