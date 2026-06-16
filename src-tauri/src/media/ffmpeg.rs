use std::path::PathBuf;

use crate::models::ToolCheck;

#[derive(Debug, Clone)]
pub struct FfmpegRunner {
    ffmpeg_path: Option<PathBuf>,
    ffprobe_path: Option<PathBuf>,
}

impl FfmpegRunner {
    pub fn detect() -> Self {
        Self {
            ffmpeg_path: which::which("ffmpeg").ok(),
            ffprobe_path: which::which("ffprobe").ok(),
        }
    }

    pub fn check_tools(&self) -> Vec<ToolCheck> {
        vec![
            tool_check("ffmpeg", self.ffmpeg_path.clone()),
            tool_check("ffprobe", self.ffprobe_path.clone()),
        ]
    }
}

fn tool_check(name: &str, path: Option<PathBuf>) -> ToolCheck {
    match path {
        Some(path) => ToolCheck {
            name: name.to_string(),
            found: true,
            path: Some(path.to_string_lossy().to_string()),
            error: None,
        },
        None => ToolCheck {
            name: name.to_string(),
            found: false,
            path: None,
            error: Some(format!("{name} not found in PATH")),
        },
    }
}
