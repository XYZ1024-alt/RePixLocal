use std::path::{Path, PathBuf};

use crate::errors::{AppError, AppResult};

const WHISPER_RUNTIME_DLLS: [&str; 4] = [
    "ggml.dll",
    "ggml-base.dll",
    "ggml-cpu.dll",
    "whisper.dll",
];

pub fn sync_whisper_runtime_near_exe() -> AppResult<()> {
    #[cfg(not(windows))]
    {
        return Ok(());
    }

    #[cfg(windows)]
    {
        let exe_dir = std::env::current_exe()
            .map_err(AppError::from)?
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| AppError::Tool("cannot resolve executable directory".into()))?;

        if whisper_runtime_ready(&exe_dir) {
            return Ok(());
        }

        let resource_dir = exe_dir.join("whisper-runtime");
        if whisper_runtime_ready(&resource_dir) {
            copy_runtime_files(&resource_dir, &exe_dir)?;
        }
        Ok(())
    }
}

pub fn whisper_runtime_search_dir(binary: &Path) -> Option<PathBuf> {
    let binary_dir = binary.parent()?;
    if whisper_runtime_ready(binary_dir) {
        return Some(binary_dir.to_path_buf());
    }
    let nested = binary_dir.join("whisper-runtime");
    if whisper_runtime_ready(&nested) {
        return Some(nested);
    }
    None
}

pub fn whisper_runtime_ready(dir: &Path) -> bool {
    WHISPER_RUNTIME_DLLS
        .iter()
        .all(|name| dir.join(name).is_file())
}

fn copy_runtime_files(source_dir: &Path, dest_dir: &Path) -> AppResult<()> {
    for name in WHISPER_RUNTIME_DLLS {
        let source = source_dir.join(name);
        let dest = dest_dir.join(name);
        if source.is_file() && !dest.is_file() {
            std::fs::copy(&source, &dest).map_err(|error| {
                AppError::Tool(format!(
                    "failed to copy whisper runtime {}: {error}",
                    source.display()
                ))
            })?;
        }
    }
    Ok(())
}

pub fn format_process_failure(exit_code: Option<i32>, stdout: &str, stderr: &str) -> String {
    let mut parts = Vec::new();
    if let Some(code) = exit_code {
        parts.push(format!("exit code {code}"));
        #[cfg(windows)]
        if code == -1073741515 || code as u32 == 0xC0000135 {
            parts.push(
                "missing whisper runtime DLLs (ggml.dll / whisper.dll); reinstall or rerun bun run fetch-tools"
                    .to_string(),
            );
        }
    }
    if !stderr.trim().is_empty() {
        parts.push(stderr.trim().to_string());
    } else if !stdout.trim().is_empty() {
        parts.push(stdout.trim().to_string());
    }
    if parts.is_empty() {
        "unknown whisper-cli failure".to_string()
    } else {
        parts.join("; ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_windows_dll_missing_exit_code() {
        let message = format_process_failure(Some(-1073741515), "", "");
        assert!(message.contains("missing whisper runtime DLLs"));
    }
}