use std::fs::{File, OpenOptions};
use std::path::PathBuf;

use directories::ProjectDirs;
use fs2::FileExt;
use tokio::fs;

use crate::errors::{AppError, AppResult};

#[derive(Debug, Clone)]
pub struct Workspace {
    root: PathBuf,
}

#[derive(Debug)]
pub struct WorkspaceInstanceLock {
    _file: File,
}

impl WorkspaceInstanceLock {
    pub fn acquire(workspace: &Workspace) -> AppResult<Self> {
        let lock_path = workspace.root.join(".instance.lock");
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(&lock_path)?;

        match FileExt::try_lock_exclusive(&file) {
            Ok(()) => Ok(Self { _file: file }),
            Err(error) if error.raw_os_error() == fs2::lock_contended_error().raw_os_error() => {
                Err(AppError::Workflow(
                    "another RePix Local instance is already using this workspace".into(),
                ))
            }
            Err(error) => Err(AppError::Filesystem(error)),
        }
    }
}

impl Workspace {
    pub async fn initialize() -> AppResult<Self> {
        let root = default_root()?;
        let workspace = Self { root };
        workspace.create_layout().await?;
        Ok(workspace)
    }

    #[cfg(test)]
    pub fn from_root(root: PathBuf) -> Self {
        Self { root }
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

    pub fn tasks_dir(&self) -> PathBuf {
        self.root.join("tasks")
    }

    pub fn task_dir(&self, task_id: &str) -> PathBuf {
        self.tasks_dir().join(task_id)
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
        "source/images",
        "audio",
        "tts",
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tasks_dir_contains_only_task_assets() {
        let root = std::env::temp_dir().join("repix-workspace-path-test");
        let workspace = Workspace::from_root(root.clone());

        assert_eq!(workspace.tasks_dir(), root.join("tasks"));
        assert_eq!(
            workspace.task_dir("task-1"),
            root.join("tasks").join("task-1")
        );
    }

    #[test]
    fn instance_lock_is_exclusive_and_released_on_drop() {
        let root =
            std::env::temp_dir().join(format!("repix-instance-lock-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let workspace = Workspace::from_root(root.clone());

        let first = WorkspaceInstanceLock::acquire(&workspace).unwrap();
        let second = WorkspaceInstanceLock::acquire(&workspace).unwrap_err();
        assert!(matches!(
            second,
            AppError::Workflow(message)
                if message == "another RePix Local instance is already using this workspace"
        ));

        drop(first);
        let reacquired = WorkspaceInstanceLock::acquire(&workspace).unwrap();
        drop(reacquired);
        std::fs::remove_dir_all(root).unwrap();
    }
}
