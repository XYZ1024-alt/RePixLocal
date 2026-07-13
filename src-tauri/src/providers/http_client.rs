use std::future::Future;
use std::time::Duration;

use reqwest::{Client, ClientBuilder, Url};

use crate::errors::{AppError, AppResult};

/// HTTP client that respects the system and environment proxy configuration.
pub fn build_http_client(timeout_secs: u64) -> AppResult<Client> {
    finish_client(client_builder(timeout_secs))
}

/// HTTP client for domestic providers that must bypass configured proxies.
pub fn build_http_client_direct(timeout_secs: u64) -> AppResult<Client> {
    finish_client(client_builder(timeout_secs).no_proxy())
}

fn client_builder(timeout_secs: u64) -> ClientBuilder {
    Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .connect_timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(10))
}

fn finish_client(builder: ClientBuilder) -> AppResult<Client> {
    builder
        .build()
        .map_err(|error| AppError::Provider(error.to_string()))
}

pub async fn retry_connect_once<T, F, Fut>(delay: Duration, mut operation: F) -> reqwest::Result<T>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = reqwest::Result<T>>,
{
    match operation().await {
        Err(error) if error.is_connect() => {
            tracing::warn!(
                delay_ms = delay.as_millis(),
                "provider connection failed, retrying once"
            );
            tokio::time::sleep(delay).await;
            operation().await
        }
        result => result,
    }
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

pub fn format_http_error(context: &str, error: reqwest::Error) -> String {
    let is_connect = error.is_connect();
    let is_timeout = error.is_timeout();
    let status = error.status();
    let request_url = error.url().map(|url| redact_parsed_url(url.clone()));
    let error = error.without_url();
    let context = redact_http_url(context);

    let mut parts = vec![format!("{context}: {error}")];
    if let Some(request_url) = request_url.filter(|url| url != &context) {
        parts.push(format!("request URL: {request_url}"));
    }
    if is_connect {
        parts.push("connection failed - check network or firewall".to_string());
    }
    if is_timeout {
        parts.push("request timed out".to_string());
    }
    if let Some(status) = status {
        parts.push(format!("HTTP status {status}"));
    }
    parts.join("; ")
}

fn redact_http_url(raw: &str) -> String {
    Url::parse(raw)
        .map(redact_parsed_url)
        .unwrap_or_else(|_| "HTTP request".to_string())
}

fn redact_parsed_url(mut url: Url) -> String {
    if url.set_password(None).is_err() || url.set_username("").is_err() {
        return "HTTP request".to_string();
    }
    url.set_query(None);
    url.set_fragment(None);
    url.to_string()
}

#[cfg(test)]
mod tests {
    use std::io::Read;
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::thread;

    use super::*;

    #[test]
    fn build_http_clients_succeed() {
        build_http_client(5).expect("client should build");
        build_http_client_direct(5).expect("direct client should build");
    }

    #[tokio::test]
    async fn retries_connect_errors_once() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let client = Client::builder()
            .timeout(Duration::from_secs(1))
            .connect_timeout(Duration::from_millis(100))
            .no_proxy()
            .build()
            .unwrap();
        let attempts = AtomicUsize::new(0);

        let error = retry_connect_once(Duration::ZERO, || {
            attempts.fetch_add(1, Ordering::SeqCst);
            client.get(format!("http://{address}")).send()
        })
        .await
        .unwrap_err();

        assert!(
            error.is_connect(),
            "expected connect error, got {error:?}; timeout={}",
            error.is_timeout()
        );
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn does_not_retry_response_timeouts() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 1024];
            let _ = stream.read(&mut request);
            thread::sleep(Duration::from_millis(200));
        });
        let client = Client::builder()
            .timeout(Duration::from_millis(25))
            .no_proxy()
            .build()
            .unwrap();
        let attempts = AtomicUsize::new(0);

        let error = retry_connect_once(Duration::ZERO, || {
            attempts.fetch_add(1, Ordering::SeqCst);
            client.get(format!("http://{address}")).send()
        })
        .await
        .unwrap_err();

        assert!(error.is_timeout());
        assert!(!error.is_connect());
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
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

    #[test]
    fn redacts_url_credentials_query_and_fragment() {
        assert_eq!(
            redact_http_url(
                "https://user:password@example.com/media/file.mp4?X-Amz-Signature=secret#token"
            ),
            "https://example.com/media/file.mp4"
        );
        assert_eq!(redact_http_url("not a URL?token=secret"), "HTTP request");
    }

    #[tokio::test]
    async fn formatted_http_errors_do_not_expose_request_secrets() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 1024];
            let _ = stream.read(&mut request);
            thread::sleep(Duration::from_millis(200));
        });
        let secret_url = format!(
            "http://user:password@{address}/asset?X-Amz-Signature=request-secret#fragment-secret"
        );
        let error = Client::builder()
            .timeout(Duration::from_millis(25))
            .no_proxy()
            .build()
            .unwrap()
            .get(&secret_url)
            .send()
            .await
            .unwrap_err();

        let message = format_http_error(
            "https://context.example/download?token=context-secret#context-fragment",
            error,
        );

        assert!(message.contains("request timed out"));
        assert!(is_transient_provider_error(&message));
        for secret in [
            "user",
            "password",
            "request-secret",
            "fragment-secret",
            "context-secret",
            "context-fragment",
        ] {
            assert!(
                !message.contains(secret),
                "message leaked {secret}: {message}"
            );
        }
        assert!(message.contains(&format!("http://{address}/asset")));
    }
}
