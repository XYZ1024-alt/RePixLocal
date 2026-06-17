use std::path::PathBuf;

use directories::ProjectDirs;
use tokio::fs;

use crate::errors::{AppError, AppResult};

#[derive(Debug, Clone)]
pub struct Workspace {
    root: PathBuf,
}

impl Workspace {
    pub async fn initialize() -> AppResult<Self> {
        let root = default_root()?;
        let workspace = Self { root };
        workspace.create_layout().await?;
        Ok(workspace)
    }

    pub fn root(&self) -> PathBuf {
        self.root.clone()
    }

    pub fn database_path(&self) -> PathBuf {
        self.root.join("repix.sqlite")
    }

    pub fn config_path(&self) -> PathBuf {
        self.root.join("config.json")
    }

    pub fn task_dir(&self, task_id: &str) -> PathBuf {
        self.root.join("tasks").join(task_id)
    }

    pub async fn create_task_layout(&self, task_id: &str) -> AppResult<()> {
        for dir in task_dirs(self.task_dir(task_id)) {
            fs::create_dir_all(dir).await?;
        }
        Ok(())
    }

    async fn create_layout(&self) -> AppResult<()> {
        for dir in ["logs", "tasks", "temp", "models/whisper"] {
            fs::create_dir_all(self.root.join(dir)).await?;
        }
        Ok(())
    }
}

fn default_root() -> AppResult<PathBuf> {
    let dirs = ProjectDirs::from("local", "RePix", "RePixLocal")
        .ok_or_else(|| AppError::Config("cannot resolve application data directory".into()))?;
    Ok(dirs.data_dir().to_path_buf())
}

fn task_dirs(task_root: PathBuf) -> Vec<PathBuf> {
    [
        "source",
        "audio",
        "keyframes",
        "frames",
        "segments",
        "subtitles",
        "final",
    ]
    .into_iter()
    .map(|name| task_root.join(name))
    .collect()
}
