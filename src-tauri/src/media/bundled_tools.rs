use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolSource {
    Configured,
    Bundled,
    SystemPath,
}

pub fn target_triple() -> &'static str {
    env!("TARGET_TRIPLE")
}

pub fn sidecar_filename(name: &str) -> String {
    #[cfg(windows)]
    {
        format!("{name}-{}.exe", target_triple())
    }
    #[cfg(not(windows))]
    {
        format!("{name}-{}", target_triple())
    }
}

pub fn sidecar_path(name: &str) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let candidate = dir.join(sidecar_filename(name));
    if candidate.is_file() && is_executable_file(&candidate) {
        Some(candidate)
    } else {
        None
    }
}

pub fn is_executable_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(windows)]
    {
        let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
            return false;
        };
        extension.eq_ignore_ascii_case("exe")
    }
    #[cfg(not(windows))]
    {
        true
    }
}

pub fn resolve_tool_path(
    configured: Option<&str>,
    sidecar_name: &str,
    path_fallback: &str,
) -> Option<PathBuf> {
    resolve_tool_path_with_source(configured, sidecar_name, path_fallback).map(|(path, _)| path)
}

pub fn resolve_tool_path_with_source(
    configured: Option<&str>,
    sidecar_name: &str,
    path_fallback: &str,
) -> Option<(PathBuf, ToolSource)> {
    if let Some(path) = configured.filter(|value| !value.trim().is_empty()) {
        let candidate = PathBuf::from(path.trim());
        return Some((candidate, ToolSource::Configured));
    }
    if let Some(path) = sidecar_path(sidecar_name) {
        return Some((path, ToolSource::Bundled));
    }
    which::which(path_fallback)
        .ok()
        .filter(|path| is_executable_file(path))
        .map(|path| (path, ToolSource::SystemPath))
}

pub fn is_bundled_path(path: &Path, sidecar_name: &str) -> bool {
    sidecar_path(sidecar_name).is_some_and(|bundled| bundled == path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_windows_control_panel_as_executable() {
        let path = Path::new(r"C:\Windows\System32\main.cpl");
        assert!(!is_executable_file(path));
    }

    #[test]
    fn accepts_windows_exe_extension() {
        let path = std::env::temp_dir().join("repix-whisper-cli-test.exe");
        std::fs::write(&path, b"").expect("temp exe");
        assert!(is_executable_file(&path));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn sidecar_filename_includes_target_triple() {
        let filename = sidecar_filename("ffmpeg");
        assert!(filename.starts_with("ffmpeg-"));
        assert!(filename.ends_with(".exe"));
    }
}