use std::path::{Path, PathBuf};

use chrono::Utc;
use tokio::fs;
use uuid::Uuid;

use crate::errors::{AppError, AppResult};
use crate::models::{Asset, AssetType};
use crate::workspace::Workspace;

#[derive(Debug, Clone)]
pub struct AssetManager {
    workspace: Workspace,
}

impl AssetManager {
    pub fn new(workspace: Workspace) -> Self {
        Self { workspace }
    }

    pub async fn import_source_video(&self, task_id: &str, source_path: &str) -> AppResult<Asset> {
        let source = PathBuf::from(source_path);
        validate_readable_file(&source).await?;
        self.workspace.create_task_layout(task_id).await?;
        let target = self.source_target(task_id, &source)?;
        fs::copy(&source, &target).await?;
        Ok(source_asset(task_id, target))
    }

    fn source_target(&self, task_id: &str, source: &Path) -> AppResult<PathBuf> {
        let file_name = source.file_name().ok_or_else(|| {
            AppError::Filesystem(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "source video path has no file name",
            ))
        })?;
        Ok(self
            .workspace
            .task_dir(task_id)
            .join("source")
            .join(file_name))
    }
}

async fn validate_readable_file(path: &Path) -> AppResult<()> {
    let metadata = fs::metadata(path).await?;
    if metadata.is_file() {
        return Ok(());
    }
    Err(AppError::Filesystem(std::io::Error::new(
        std::io::ErrorKind::InvalidInput,
        "source path is not a file",
    )))
}

fn source_asset(task_id: &str, path: PathBuf) -> Asset {
    Asset {
        id: Uuid::new_v4().to_string(),
        task_id: task_id.to_string(),
        run_id: None,
        asset_type: AssetType::SourceVideo,
        path: path.to_string_lossy().to_string(),
        mime_type: Some("video/*".to_string()),
        scene_index: None,
        created_at: Utc::now(),
    }
}
