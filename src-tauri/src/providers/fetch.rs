use std::error::Error;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use reqwest::header::{HeaderMap, CONTENT_TYPE, LOCATION};
use reqwest::{Client, Response, StatusCode, Url};
use tokio::io::AsyncWriteExt;

use crate::errors::{AppError, AppResult};
use crate::providers::http_client::format_http_error;

const CONNECT_TIMEOUT_SECS: u64 = 15;
const DOWNLOAD_TIMEOUT_SECS: u64 = 300;
const MAX_REDIRECTS: usize = 10;
const MEBIBYTE: u64 = 1024 * 1024;
const PNG_MAX_BYTES: u64 = 20 * MEBIBYTE;
const WAV_MAX_BYTES: u64 = 100 * MEBIBYTE;
const MP4_MAX_BYTES: u64 = 500 * MEBIBYTE;
const ERROR_BODY_MAX_BYTES: usize = 8 * 1024;
const BENCHMARK_IPV4_NETWORK: Ipv4Addr = Ipv4Addr::new(198, 18, 0, 0);
const BENCHMARK_IPV4_PREFIX: u8 = 15;
const MIHOMO_FAKE_IPV4_PREFIX: u8 = 16;
const HTTPS_PORT: u16 = 443;

// Clash/Mihomo defaults to 198.18.0.0/16 for synthetic DNS answers.
const ARK_CONTENT_GENERATION_BJ_TOS_HOST: &str =
    "ark-content-generation-cn-beijing.tos-cn-beijing.volces.com";
const DASHSCOPE_OSS_BUCKET_PREFIX: &str = "dashscope-";
const DASHSCOPE_RESULT_BJ_OSS_HOST: &str = "dashscope-result-bj.oss-cn-beijing.aliyuncs.com";
const OSS_ACCELERATE_HOST_SUFFIX: &str = ".oss-accelerate.aliyuncs.com";

const PNG_CONTENT_TYPES: &[&str] = &["image/png"];
const WAV_CONTENT_TYPES: &[&str] = &["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"];
const MP4_CONTENT_TYPES: &[&str] = &["video/mp4"];

const BLOCKED_IPV4_RANGES: &[(Ipv4Addr, u8)] = &[
    (Ipv4Addr::new(0, 0, 0, 0), 8),
    (Ipv4Addr::new(10, 0, 0, 0), 8),
    (Ipv4Addr::new(100, 64, 0, 0), 10),
    (Ipv4Addr::new(127, 0, 0, 0), 8),
    (Ipv4Addr::new(169, 254, 0, 0), 16),
    (Ipv4Addr::new(172, 16, 0, 0), 12),
    (Ipv4Addr::new(192, 0, 0, 0), 24),
    (Ipv4Addr::new(192, 0, 2, 0), 24),
    (Ipv4Addr::new(192, 88, 99, 0), 24),
    (Ipv4Addr::new(192, 168, 0, 0), 16),
    (BENCHMARK_IPV4_NETWORK, BENCHMARK_IPV4_PREFIX),
    (Ipv4Addr::new(198, 51, 100, 0), 24),
    (Ipv4Addr::new(203, 0, 113, 0), 24),
    (Ipv4Addr::new(224, 0, 0, 0), 4),
    (Ipv4Addr::new(240, 0, 0, 0), 4),
];

struct ResolvedTarget {
    host: String,
    addresses: Vec<SocketAddr>,
    allow_proxy_fake_ip: bool,
}

struct PinnedResolver {
    host: String,
    addresses: Vec<SocketAddr>,
}

impl Resolve for PinnedResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let result: Result<Addrs, Box<dyn Error + Send + Sync>> =
            if dns_names_match(name.as_str(), &self.host) {
                Ok(Box::new(self.addresses.clone().into_iter()))
            } else {
                Err(Box::new(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    format!("refused DNS resolution for unverified host {name:?}"),
                )))
            };
        Box::pin(std::future::ready(result))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DownloadKind {
    PngImage,
    WavAudio,
    Mp4Video,
}

#[derive(Debug, Clone, Copy)]
struct DownloadPolicy {
    label: &'static str,
    max_bytes: u64,
    content_types: &'static [&'static str],
}

impl DownloadKind {
    fn policy(self) -> DownloadPolicy {
        match self {
            Self::PngImage => DownloadPolicy {
                label: "PNG image",
                max_bytes: PNG_MAX_BYTES,
                content_types: PNG_CONTENT_TYPES,
            },
            Self::WavAudio => DownloadPolicy {
                label: "WAV audio",
                max_bytes: WAV_MAX_BYTES,
                content_types: WAV_CONTENT_TYPES,
            },
            Self::Mp4Video => DownloadPolicy {
                label: "MP4 video",
                max_bytes: MP4_MAX_BYTES,
                content_types: MP4_CONTENT_TYPES,
            },
        }
    }
}

pub async fn download_to_file(url: &str, dest: &Path, kind: DownloadKind) -> AppResult<()> {
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    if dest.exists() {
        return Err(AppError::Provider(format!(
            "download destination already exists: {}",
            dest.display()
        )));
    }
    let response = send_safe_get(parse_download_url(url)?).await?;
    if !response.status().is_success() {
        let status = response.status();
        let body = read_error_body(response).await?;
        return Err(AppError::Provider(format!(
            "download failed ({status}): {body}"
        )));
    }
    let policy = kind.policy();
    validate_content_type(response.headers(), policy)?;
    persist_response(response, dest, policy).await
}

async fn read_error_body(mut response: Response) -> AppResult<String> {
    let response_url = response.url().as_str().to_string();
    let mut body = Vec::with_capacity(ERROR_BODY_MAX_BYTES);
    let mut truncated = false;
    while body.len() < ERROR_BODY_MAX_BYTES {
        let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| AppError::Provider(format_http_error(&response_url, error)))?
        else {
            break;
        };
        let remaining = ERROR_BODY_MAX_BYTES - body.len();
        let copied = remaining.min(chunk.len());
        body.extend_from_slice(&chunk[..copied]);
        if copied < chunk.len() || body.len() == ERROR_BODY_MAX_BYTES {
            truncated = true;
            break;
        }
    }
    let mut text = String::from_utf8_lossy(&body).into_owned();
    if truncated {
        text.push_str(" [truncated]");
    }
    Ok(text)
}

async fn send_safe_get(mut url: Url) -> AppResult<Response> {
    for redirect_count in 0..=MAX_REDIRECTS {
        let response = request_url(&url).await?;
        if !is_followed_redirect(response.status()) {
            return Ok(response);
        }
        if redirect_count == MAX_REDIRECTS {
            return Err(AppError::Provider(format!(
                "download exceeded {MAX_REDIRECTS} redirects"
            )));
        }
        url = redirect_url(&url, &response)?;
    }
    unreachable!("redirect loop always returns or errors")
}

async fn request_url(url: &Url) -> AppResult<Response> {
    let target = resolve_public_target(url).await?;
    let client = build_pinned_client(&target)?;
    let response = client
        .get(url.clone())
        .send()
        .await
        .map_err(|error| AppError::Provider(format_http_error(url.as_str(), error)))?;
    validate_remote_address(&response, &target)?;
    Ok(response)
}

fn parse_download_url(raw: &str) -> AppResult<Url> {
    let url = Url::parse(raw)
        .map_err(|error| AppError::Provider(format!("invalid download URL: {error}")))?;
    normalize_download_url(url)
}

fn normalize_download_url(mut url: Url) -> AppResult<Url> {
    if url.scheme() == "http"
        && url.port_or_known_default() == Some(80)
        && url.host_str().is_some_and(is_dashscope_result_bj_oss_host)
    {
        url.set_scheme("https")
            .map_err(|_| AppError::Provider("failed to secure DashScope result URL".into()))?;
        url.set_port(None)
            .map_err(|_| AppError::Provider("failed to secure DashScope result URL".into()))?;
    }
    validate_download_url(&url)?;
    Ok(url)
}

fn validate_download_url(url: &Url) -> AppResult<()> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err(AppError::Provider(
            "download URL must use http or https".into(),
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::Provider(
            "download URL must not contain user credentials".into(),
        ));
    }
    if url.host_str().is_none() || url.port_or_known_default().is_none() {
        return Err(AppError::Provider(
            "download URL must contain a valid host and port".into(),
        ));
    }
    Ok(())
}

async fn resolve_public_target(url: &Url) -> AppResult<ResolvedTarget> {
    let host = url
        .host_str()
        .ok_or_else(|| AppError::Provider("download URL has no host".into()))?
        .to_string();
    let port = url
        .port_or_known_default()
        .ok_or_else(|| AppError::Provider("download URL has no valid port".into()))?;
    let ip_host = host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(&host);
    let addresses = match ip_host.parse::<IpAddr>() {
        Ok(ip) => vec![SocketAddr::new(ip, port)],
        Err(_) => tokio::time::timeout(
            Duration::from_secs(CONNECT_TIMEOUT_SECS),
            tokio::net::lookup_host((host.as_str(), port)),
        )
        .await
        .map_err(|_| AppError::Provider(format!("timed out resolving download host {host}")))?
        .map_err(|error| {
            AppError::Provider(format!("failed to resolve download host {host}: {error}"))
        })?
        .collect(),
    };
    let allow_proxy_fake_ip = allows_proxy_fake_ip(url, &host);
    validate_resolved_addresses(&host, &addresses, allow_proxy_fake_ip)?;
    Ok(ResolvedTarget {
        host,
        addresses,
        allow_proxy_fake_ip,
    })
}

fn validate_resolved_addresses(
    host: &str,
    addresses: &[SocketAddr],
    allow_proxy_fake_ip: bool,
) -> AppResult<()> {
    if addresses.is_empty() {
        return Err(AppError::Provider(format!(
            "download host {host} resolved to no addresses"
        )));
    }
    if let Some(address) = addresses
        .iter()
        .find(|address| !is_allowed_target_ip(address.ip(), allow_proxy_fake_ip))
    {
        return Err(AppError::Provider(format!(
            "download host {host} resolved to non-public address {}",
            address.ip()
        )));
    }
    Ok(())
}

fn build_pinned_client(target: &ResolvedTarget) -> AppResult<Client> {
    let resolver = PinnedResolver {
        host: target.host.clone(),
        addresses: target.addresses.clone(),
    };
    Client::builder()
        .timeout(Duration::from_secs(DOWNLOAD_TIMEOUT_SECS))
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .dns_resolver(Arc::new(resolver))
        .build()
        .map_err(|error| AppError::Provider(error.to_string()))
}

fn dns_names_match(left: &str, right: &str) -> bool {
    left.trim_end_matches('.')
        .eq_ignore_ascii_case(right.trim_end_matches('.'))
}

fn validate_remote_address(response: &Response, target: &ResolvedTarget) -> AppResult<()> {
    let remote = response
        .remote_addr()
        .ok_or_else(|| AppError::Provider("download response has no remote address".into()))?;
    let remote_ip = normalize_ip(remote.ip());
    let matches_resolved = target
        .addresses
        .iter()
        .any(|address| normalize_ip(address.ip()) == remote_ip);
    if !is_allowed_target_ip(remote_ip, target.allow_proxy_fake_ip) || !matches_resolved {
        return Err(AppError::Provider(format!(
            "download connected to unverified remote address {remote_ip}"
        )));
    }
    Ok(())
}

fn redirect_url(current: &Url, response: &Response) -> AppResult<Url> {
    let location = response
        .headers()
        .get(LOCATION)
        .ok_or_else(|| AppError::Provider("download redirect has no Location header".into()))?
        .to_str()
        .map_err(|error| AppError::Provider(format!("invalid redirect Location: {error}")))?;
    join_redirect_url(current, location)
}

fn join_redirect_url(current: &Url, location: &str) -> AppResult<Url> {
    let url = current
        .join(location)
        .map_err(|error| AppError::Provider(format!("invalid download redirect: {error}")))?;
    normalize_download_url(url)
}

fn is_followed_redirect(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::MOVED_PERMANENTLY
            | StatusCode::FOUND
            | StatusCode::SEE_OTHER
            | StatusCode::TEMPORARY_REDIRECT
            | StatusCode::PERMANENT_REDIRECT
    )
}

fn validate_content_type(headers: &HeaderMap, policy: DownloadPolicy) -> AppResult<()> {
    let mut values = headers.get_all(CONTENT_TYPE).iter();
    let value = values.next().ok_or_else(|| {
        AppError::Provider(format!(
            "downloaded {} response has no Content-Type",
            policy.label
        ))
    })?;
    if values.next().is_some() {
        return Err(AppError::Provider(format!(
            "downloaded {} response has multiple Content-Type headers",
            policy.label
        )));
    }
    let raw = value.to_str().map_err(|error| {
        AppError::Provider(format!(
            "downloaded {} response has invalid Content-Type: {error}",
            policy.label
        ))
    })?;
    let media_type = raw.split(';').next().unwrap_or_default().trim();
    if !policy
        .content_types
        .iter()
        .any(|expected| media_type.eq_ignore_ascii_case(expected))
    {
        return Err(AppError::Provider(format!(
            "downloaded {} response has unsupported Content-Type {media_type:?}",
            policy.label
        )));
    }
    Ok(())
}

fn is_public_ip(ip: IpAddr) -> bool {
    match normalize_ip(ip) {
        IpAddr::V4(ip) => !BLOCKED_IPV4_RANGES
            .iter()
            .any(|(network, prefix)| ipv4_in_prefix(ip, *network, *prefix)),
        IpAddr::V6(ip) => is_public_ipv6(ip),
    }
}

fn is_allowed_target_ip(ip: IpAddr, allow_proxy_fake_ip: bool) -> bool {
    is_public_ip(ip) || (allow_proxy_fake_ip && is_proxy_fake_ip(ip))
}

fn is_proxy_fake_ip(ip: IpAddr) -> bool {
    matches!(
        normalize_ip(ip),
        IpAddr::V4(ip)
            if ipv4_in_prefix(ip, BENCHMARK_IPV4_NETWORK, MIHOMO_FAKE_IPV4_PREFIX)
    )
}

fn allows_proxy_fake_ip(url: &Url, host: &str) -> bool {
    url.scheme() == "https"
        && url.port_or_known_default() == Some(HTTPS_PORT)
        && is_trusted_provider_download_host(host)
}

fn is_trusted_provider_download_host(host: &str) -> bool {
    is_trusted_dashscope_oss_host(host) || is_ark_content_generation_bj_tos_host(host)
}

fn is_trusted_dashscope_oss_host(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if is_dashscope_result_bj_oss_host(&host) {
        return true;
    }
    host.strip_suffix(OSS_ACCELERATE_HOST_SUFFIX)
        .is_some_and(|bucket| {
            bucket.starts_with(DASHSCOPE_OSS_BUCKET_PREFIX) && !bucket.contains('.')
        })
}

fn is_dashscope_result_bj_oss_host(host: &str) -> bool {
    host.trim_end_matches('.')
        .eq_ignore_ascii_case(DASHSCOPE_RESULT_BJ_OSS_HOST)
}

fn is_ark_content_generation_bj_tos_host(host: &str) -> bool {
    host.trim_end_matches('.')
        .eq_ignore_ascii_case(ARK_CONTENT_GENERATION_BJ_TOS_HOST)
}

fn normalize_ip(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(ip) => ip
            .to_ipv4_mapped()
            .map(IpAddr::V4)
            .unwrap_or(IpAddr::V6(ip)),
        ip => ip,
    }
}

fn ipv4_in_prefix(ip: Ipv4Addr, network: Ipv4Addr, prefix: u8) -> bool {
    let mask = u32::MAX << (32 - u32::from(prefix));
    u32::from(ip) & mask == u32::from(network) & mask
}

fn is_public_ipv6(ip: Ipv6Addr) -> bool {
    let segments = ip.segments();
    let is_global_unicast = segments[0] & 0xe000 == 0x2000;
    let is_ietf_special = segments[0] == 0x2001 && segments[1] < 0x0200;
    let is_documentation = (segments[0] == 0x2001 && segments[1] == 0x0db8)
        || (segments[0] == 0x3fff && segments[1] < 0x1000);
    let is_six_to_four = segments[0] == 0x2002;
    is_global_unicast && !is_ietf_special && !is_documentation && !is_six_to_four
}

async fn persist_response(
    response: Response,
    dest: &Path,
    policy: DownloadPolicy,
) -> AppResult<()> {
    let expected_bytes = response.content_length();
    validate_declared_size(expected_bytes, policy)?;
    let temp_path = download_temp_path(dest)?;
    let result = write_response(response, &temp_path, expected_bytes, policy).await;
    let result = match result {
        Ok(()) => tokio::fs::rename(&temp_path, dest).await.map_err(|error| {
            AppError::Provider(format!("failed to finalize download file: {error}"))
        }),
        Err(error) => Err(error),
    };

    if let Err(error) = result {
        return match tokio::fs::remove_file(&temp_path).await {
            Ok(()) => Err(error),
            Err(cleanup_error) if cleanup_error.kind() == std::io::ErrorKind::NotFound => {
                Err(error)
            }
            Err(cleanup_error) => Err(AppError::Provider(format!(
                "{error}; failed to remove temporary download {}: {cleanup_error}",
                temp_path.display()
            ))),
        };
    }
    Ok(())
}

async fn write_response(
    mut response: reqwest::Response,
    temp_path: &Path,
    expected_bytes: Option<u64>,
    policy: DownloadPolicy,
) -> AppResult<()> {
    let response_url = response.url().as_str().to_string();
    let mut file = tokio::fs::File::create(temp_path)
        .await
        .map_err(|error| AppError::Provider(format!("failed to create download file: {error}")))?;
    let mut downloaded_bytes = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| AppError::Provider(format_http_error(&response_url, error)))?
    {
        let chunk_bytes = u64::try_from(chunk.len())
            .map_err(|_| AppError::Provider("download chunk size overflow".into()))?;
        let next_size = downloaded_bytes.checked_add(chunk_bytes).ok_or_else(|| {
            AppError::Provider(format!("downloaded {} size overflow", policy.label))
        })?;
        if next_size > policy.max_bytes {
            return Err(download_too_large_error(policy));
        }
        file.write_all(&chunk).await.map_err(|error| {
            AppError::Provider(format!("failed to write download chunk: {error}"))
        })?;
        downloaded_bytes = next_size;
    }
    validate_download_size(downloaded_bytes, expected_bytes)?;
    file.flush()
        .await
        .map_err(|error| AppError::Provider(format!("failed to flush download file: {error}")))?;
    file.sync_all()
        .await
        .map_err(|error| AppError::Provider(format!("failed to sync download file: {error}")))
}

fn validate_declared_size(expected_bytes: Option<u64>, policy: DownloadPolicy) -> AppResult<()> {
    if expected_bytes.is_some_and(|size| size > policy.max_bytes) {
        return Err(download_too_large_error(policy));
    }
    Ok(())
}

fn download_too_large_error(policy: DownloadPolicy) -> AppError {
    AppError::Provider(format!(
        "downloaded {} exceeds the {} byte limit",
        policy.label, policy.max_bytes
    ))
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

        persist_response(local_response(&url).await, &dest, test_policy(4))
            .await
            .unwrap();

        assert_eq!(tokio::fs::read(&dest).await.unwrap(), b"data");
        assert!(download_temp_files(&dir).is_empty());
        let _ = tokio::fs::remove_dir_all(dir).await;
    }

    #[tokio::test]
    async fn interrupted_download_leaves_no_destination_or_temp_file() {
        let url = format!(
            "{}?X-Amz-Signature=write-secret",
            serve_once(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nshort")
        );
        let dir = test_dir();
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let dest = dir.join("asset.bin");

        let error = persist_response(local_response(&url).await, &dest, test_policy(100))
            .await
            .unwrap_err();

        assert!(error.to_string().contains("body") || error.to_string().contains("size"));
        assert!(!error.to_string().contains("write-secret"));
        assert!(!dest.exists());
        assert!(download_temp_files(&dir).is_empty());
        let _ = tokio::fs::remove_dir_all(dir).await;
    }

    #[test]
    fn validates_media_content_types_and_wav_aliases() {
        let accepted = [
            (DownloadKind::PngImage, "image/png"),
            (DownloadKind::PngImage, "IMAGE/PNG; charset=binary"),
            (DownloadKind::WavAudio, "audio/wav"),
            (DownloadKind::WavAudio, "audio/x-wav"),
            (DownloadKind::WavAudio, "audio/wave"),
            (DownloadKind::WavAudio, "audio/vnd.wave"),
            (DownloadKind::Mp4Video, "video/mp4; profile=main"),
        ];
        for (kind, content_type) in accepted {
            let mut headers = HeaderMap::new();
            headers.insert(CONTENT_TYPE, content_type.parse().unwrap());
            assert!(
                validate_content_type(&headers, kind.policy()).is_ok(),
                "Content-Type should be accepted: {content_type}"
            );
        }
    }

    #[test]
    fn rejects_missing_ambiguous_and_unexpected_content_types() {
        assert!(validate_content_type(&HeaderMap::new(), DownloadKind::PngImage.policy()).is_err());

        let mut wrong = HeaderMap::new();
        wrong.insert(CONTENT_TYPE, "application/octet-stream".parse().unwrap());
        assert!(validate_content_type(&wrong, DownloadKind::PngImage.policy()).is_err());

        let mut duplicate = HeaderMap::new();
        duplicate.append(CONTENT_TYPE, "image/png".parse().unwrap());
        duplicate.append(CONTENT_TYPE, "video/mp4".parse().unwrap());
        assert!(validate_content_type(&duplicate, DownloadKind::PngImage.policy()).is_err());
    }

    #[tokio::test]
    async fn declared_oversize_download_leaves_no_files() {
        let url = serve_once(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\ndata");
        let dir = test_dir();
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let dest = dir.join("asset.bin");

        let error = persist_response(local_response(&url).await, &dest, test_policy(3))
            .await
            .unwrap_err();

        assert!(error.to_string().contains("exceeds"));
        assert!(!dest.exists());
        assert!(download_temp_files(&dir).is_empty());
        let _ = tokio::fs::remove_dir_all(dir).await;
    }

    #[tokio::test]
    async fn chunked_oversize_download_leaves_no_files() {
        let url = serve_once(
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\ndata\r\n0\r\n\r\n",
        );
        let dir = test_dir();
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let dest = dir.join("asset.bin");

        let error = persist_response(local_response(&url).await, &dest, test_policy(3))
            .await
            .unwrap_err();

        assert!(error.to_string().contains("exceeds"));
        assert!(!dest.exists());
        assert!(download_temp_files(&dir).is_empty());
        let _ = tokio::fs::remove_dir_all(dir).await;
    }

    #[tokio::test]
    async fn error_response_body_is_bounded() {
        let body = "x".repeat(ERROR_BODY_MAX_BYTES + 512);
        let response = format!(
            "HTTP/1.1 500 Internal Server Error\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        );
        let url = serve_once(response.as_bytes());

        let excerpt = read_error_body(local_response(&url).await).await.unwrap();

        assert_eq!(excerpt.len(), ERROR_BODY_MAX_BYTES + " [truncated]".len());
        assert!(excerpt.ends_with(" [truncated]"));
    }

    #[tokio::test]
    async fn interrupted_error_body_does_not_expose_url_query() {
        let url = format!(
            "{}?X-Amz-Signature=error-secret",
            serve_once(b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 10\r\n\r\nshort")
        );

        let error = read_error_body(local_response(&url).await)
            .await
            .unwrap_err();

        assert!(!error.to_string().contains("error-secret"));
        assert!(!error.to_string().contains("X-Amz-Signature"));
    }

    #[test]
    fn rejects_invalid_download_url_structures() {
        for url in [
            "file:///tmp/asset",
            "ftp://example.com/asset",
            "https://user:pass@example.com/asset",
            "https://",
        ] {
            assert!(
                parse_download_url(url).is_err(),
                "URL should be rejected: {url}"
            );
        }
        assert!(parse_download_url("https://example.com/asset").is_ok());
    }

    #[test]
    fn accepts_only_public_unicast_addresses() {
        let blocked = [
            "0.0.0.0",
            "10.0.0.1",
            "100.64.0.1",
            "127.0.0.1",
            "169.254.169.254",
            "172.16.0.1",
            "192.168.0.1",
            "192.0.2.1",
            "198.18.0.1",
            "198.51.100.1",
            "203.0.113.1",
            "224.0.0.1",
            "240.0.0.1",
            "::",
            "::1",
            "::ffff:127.0.0.1",
            "fc00::1",
            "fe80::1",
            "ff00::1",
            "2001:db8::1",
            "2002:7f00:1::1",
            "3fff::1",
        ];
        for raw in blocked {
            let ip = raw.parse().unwrap();
            assert!(!is_public_ip(ip), "address should be blocked: {raw}");
        }
        for raw in ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"] {
            let ip = raw.parse().unwrap();
            assert!(is_public_ip(ip), "address should be public: {raw}");
        }
    }

    #[test]
    fn allows_proxy_fake_ip_only_for_trusted_https_download_hosts() {
        for raw in [
            "https://dashscope-7c2c.oss-accelerate.aliyuncs.com/asset.wav",
            "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/asset.wav",
            "https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com/asset.mp4",
        ] {
            let url = parse_download_url(raw).unwrap();
            assert!(
                allows_proxy_fake_ip(&url, url.host_str().unwrap()),
                "fake IP should be allowed for {raw}"
            );
        }

        for raw in [
            "http://dashscope-7c2c.oss-accelerate.aliyuncs.com/asset.wav",
            "https://dashscope-7c2c.oss-accelerate.aliyuncs.com:444/asset.wav",
            "https://other-bucket.oss-accelerate.aliyuncs.com/asset.wav",
            "https://nested.dashscope-7c2c.oss-accelerate.aliyuncs.com/asset.wav",
            "https://oss-accelerate.aliyuncs.com.example.com/asset.wav",
            "http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com:8080/asset.wav",
            "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com:444/asset.wav",
            "https://other-bucket.oss-cn-beijing.aliyuncs.com/asset.wav",
            "https://dashscope-result-bj.oss-cn-shanghai.aliyuncs.com/asset.wav",
            "https://nested.dashscope-result-bj.oss-cn-beijing.aliyuncs.com/asset.wav",
            "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com.example.com/asset.wav",
            "http://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com/asset.mp4",
            "https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com:444/asset.mp4",
            "https://other-bucket.tos-cn-beijing.volces.com/asset.mp4",
            "https://ark-content-generation-cn-shanghai.tos-cn-shanghai.volces.com/asset.mp4",
            "https://nested.ark-content-generation-cn-beijing.tos-cn-beijing.volces.com/asset.mp4",
            "https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com.example.com/asset.mp4",
            "https://aliyuncs.com/asset.wav",
            "https://198.18.1.242/asset.wav",
            "https://example.com/asset.wav",
        ] {
            let url = parse_download_url(raw).unwrap();
            assert!(
                !allows_proxy_fake_ip(&url, url.host_str().unwrap()),
                "fake IP should not be allowed for {raw}"
            );
        }
    }

    #[test]
    fn upgrades_documented_dashscope_result_url_to_https() {
        let raw = concat!(
            "http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/",
            "pre/cosyvoice-v3-flash/asset.wav?Expires=123&Signature=test"
        );
        let url = parse_download_url(raw).unwrap();

        assert_eq!(url.scheme(), "https");
        assert_eq!(url.port_or_known_default(), Some(HTTPS_PORT));
        assert_eq!(url.path(), "/pre/cosyvoice-v3-flash/asset.wav");
        assert_eq!(url.query(), Some("Expires=123&Signature=test"));
        assert!(allows_proxy_fake_ip(&url, url.host_str().unwrap()));

        let explicit_port = raw.replacen(
            "dashscope-result-bj.oss-cn-beijing.aliyuncs.com",
            "dashscope-result-bj.oss-cn-beijing.aliyuncs.com:80",
            1,
        );
        assert_eq!(parse_download_url(&explicit_port).unwrap(), url);

        let current = parse_download_url("https://example.com/asset").unwrap();
        let redirected = join_redirect_url(&current, raw).unwrap();
        assert_eq!(redirected, url);
    }

    #[test]
    fn trusted_fake_ip_does_not_allow_other_private_addresses() {
        let fake_ip = "198.18.1.242:443".parse().unwrap();
        let ark_fake_ip = "198.18.2.160:443".parse().unwrap();
        let other_benchmark_ip = "198.19.1.242:443".parse().unwrap();
        let loopback = "127.0.0.1:443".parse().unwrap();

        assert!(validate_resolved_addresses("example.com", &[fake_ip], false).is_err());
        assert!(validate_resolved_addresses(
            "dashscope-7c2c.oss-accelerate.aliyuncs.com",
            &[fake_ip],
            true
        )
        .is_ok());
        let ark_url = parse_download_url(
            "https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com/asset.mp4",
        )
        .unwrap();
        assert!(validate_resolved_addresses(
            ark_url.host_str().unwrap(),
            &[ark_fake_ip],
            allows_proxy_fake_ip(&ark_url, ark_url.host_str().unwrap())
        )
        .is_ok());
        assert!(validate_resolved_addresses(
            "dashscope-7c2c.oss-accelerate.aliyuncs.com",
            &[other_benchmark_ip],
            true
        )
        .is_err());
        assert!(validate_resolved_addresses(
            "dashscope-7c2c.oss-accelerate.aliyuncs.com",
            &[fake_ip, loopback],
            true
        )
        .is_err());
    }

    #[tokio::test]
    async fn rejects_loopback_literals_and_localhost_dns() {
        for raw in ["http://127.0.0.1/asset", "http://[::1]/asset"] {
            let url = parse_download_url(raw).unwrap();
            assert!(resolve_public_target(&url).await.is_err());
        }
        let localhost = parse_download_url("http://localhost/asset").unwrap();
        assert!(resolve_public_target(&localhost).await.is_err());
    }

    #[tokio::test]
    async fn accepts_public_ipv6_literals_without_dns_lookup() {
        let url = parse_download_url("https://[2606:4700:4700::1111]/asset").unwrap();
        let target = resolve_public_target(&url).await.unwrap();

        assert_eq!(
            target.addresses,
            vec!["[2606:4700:4700::1111]:443".parse().unwrap()]
        );
    }

    #[tokio::test]
    async fn rejects_redirect_targets_that_resolve_to_loopback() {
        let current = parse_download_url("https://example.com/path/asset").unwrap();
        let relative = join_redirect_url(&current, "../next").unwrap();
        assert_eq!(relative.as_str(), "https://example.com/next");

        let private = join_redirect_url(&current, "http://127.0.0.1/admin").unwrap();
        assert!(resolve_public_target(&private).await.is_err());
        assert!(join_redirect_url(&current, "ftp://example.com/asset").is_err());
        assert!(join_redirect_url(&current, "https://user:pass@example.com/asset").is_err());
    }

    #[tokio::test]
    async fn pinned_resolver_rejects_unverified_hosts() {
        let resolver = PinnedResolver {
            host: "example.com".into(),
            addresses: vec!["1.1.1.1:443".parse().unwrap()],
        };

        let allowed: Name = "EXAMPLE.COM".parse().unwrap();
        assert_eq!(
            resolver.resolve(allowed).await.unwrap().collect::<Vec<_>>(),
            resolver.addresses
        );
        let denied: Name = "other.example".parse().unwrap();
        assert!(resolver.resolve(denied).await.is_err());
    }

    async fn local_response(url: &str) -> Response {
        crate::providers::http_client::build_http_client(5)
            .unwrap()
            .get(url)
            .send()
            .await
            .unwrap()
    }

    fn serve_once(response: &[u8]) -> String {
        let response = response.to_vec();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 1024];
            let _ = stream.read(&mut request);
            stream.write_all(&response).unwrap();
        });
        format!("http://{address}/asset")
    }

    fn test_policy(max_bytes: u64) -> DownloadPolicy {
        DownloadPolicy {
            label: "test asset",
            max_bytes,
            content_types: &["application/octet-stream"],
        }
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
