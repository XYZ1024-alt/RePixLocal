use std::time::Duration;

use reqwest::Client;

use crate::errors::{AppError, AppResult};

pub fn build_http_client(timeout_secs: u64) -> AppResult<Client> {
    let mut builder = Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .redirect(reqwest::redirect::Policy::limited(10));

    if let Some(proxy_url) = proxy_from_env() {
        let mut proxy = reqwest::Proxy::all(&proxy_url).map_err(|error| {
            AppError::Provider(format!("invalid proxy URL ({proxy_url}): {error}"))
        })?;
        if let Some(no_proxy) = reqwest::NoProxy::from_env() {
            proxy = proxy.no_proxy(Some(no_proxy));
        }
        builder = builder.proxy(proxy);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_http_client_succeeds_without_proxy() {
        build_http_client(5).expect("client should build");
    }
}