use chrono::Utc;
use serde_json::Value;
use sqlx::{sqlite::SqliteConnectOptions, Executor, Row, SqlitePool};
use uuid::Uuid;

use crate::errors::AppResult;
use crate::models::{
    Asset, AssetType, CreateTaskInput, PipelineRun, ProviderCredentialInput, RunStatus,
    StageStatus, StageType, Task, TaskStatus,
};
use crate::secrets::encrypt_secret;
use crate::workspace::Workspace;

#[derive(Debug, Clone)]
pub struct Repository {
    pool: SqlitePool,
}

impl Repository {
    pub async fn initialize(workspace: &Workspace) -> AppResult<Self> {
        let options = SqliteConnectOptions::new()
            .filename(workspace.database_path())
            .create_if_missing(true);
        let pool = SqlitePool::connect_with(options).await?;
        pool.execute(include_str!("migrations/0001_init.sql"))
            .await?;
        Ok(Self { pool })
    }

    pub async fn create_task(&self, input: CreateTaskInput) -> AppResult<Task> {
        let now = Utc::now();
        let task = Task {
            id: Uuid::new_v4().to_string(),
            title: input.title,
            source_path: input.source_path,
            status: TaskStatus::Draft,
            config_json: input.config_json,
            created_at: now,
            updated_at: now,
        };
        insert_task(&self.pool, &task).await?;
        Ok(task)
    }

    pub async fn list_tasks(&self) -> AppResult<Vec<Task>> {
        let rows = sqlx::query("SELECT * FROM tasks ORDER BY created_at DESC")
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(row_to_task).collect()
    }

    pub async fn get_task(&self, task_id: &str) -> AppResult<Option<Task>> {
        let row = sqlx::query("SELECT * FROM tasks WHERE id = ?")
            .bind(task_id)
            .fetch_optional(&self.pool)
            .await?;
        row.map(row_to_task).transpose()
    }

    pub async fn update_task_status(&self, task_id: &str, status: TaskStatus) -> AppResult<()> {
        sqlx::query("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?")
            .bind(status_text(&status))
            .bind(Utc::now().to_rfc3339())
            .bind(task_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn create_run(&self, task_id: &str) -> AppResult<PipelineRun> {
        let run = PipelineRun {
            id: Uuid::new_v4().to_string(),
            task_id: task_id.to_string(),
            status: RunStatus::Running,
            current_stage: None,
            error: None,
            started_at: Some(Utc::now()),
            finished_at: None,
        };
        sqlx::query("INSERT INTO runs VALUES (?, ?, ?, NULL, NULL, ?, NULL)")
            .bind(&run.id)
            .bind(&run.task_id)
            .bind(run_status_text(&run.status))
            .bind(run.started_at.map(|value| value.to_rfc3339()))
            .execute(&self.pool)
            .await?;
        Ok(run)
    }

    pub async fn start_stage(&self, run_id: &str, stage: StageType) -> AppResult<()> {
        sqlx::query("INSERT INTO stages VALUES (?, ?, ?, ?, NULL, ?, NULL)")
            .bind(Uuid::new_v4().to_string())
            .bind(run_id)
            .bind(stage_type_text(&stage))
            .bind(stage_status_text(&StageStatus::Running))
            .bind(Utc::now().to_rfc3339())
            .execute(&self.pool)
            .await?;
        self.update_run_stage(run_id, Some(stage), RunStatus::Running, None)
            .await
    }

    pub async fn fail_run(&self, run_id: &str, stage: StageType, error: &str) -> AppResult<()> {
        sqlx::query("UPDATE stages SET status = ?, error = ?, finished_at = ? WHERE run_id = ? AND stage_type = ?")
            .bind(stage_status_text(&StageStatus::Failed))
            .bind(error)
            .bind(Utc::now().to_rfc3339())
            .bind(run_id)
            .bind(stage_type_text(&stage))
            .execute(&self.pool)
            .await?;
        self.update_run_stage(run_id, Some(stage), RunStatus::Failed, Some(error))
            .await
    }

    pub async fn list_assets(&self, task_id: &str) -> AppResult<Vec<Asset>> {
        let rows = sqlx::query("SELECT * FROM assets WHERE task_id = ? ORDER BY created_at ASC")
            .bind(task_id)
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(row_to_asset).collect()
    }

    pub async fn insert_asset(&self, asset: &Asset) -> AppResult<()> {
        sqlx::query("INSERT INTO assets VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(&asset.id)
            .bind(&asset.task_id)
            .bind(&asset.run_id)
            .bind(asset_type_text(&asset.asset_type))
            .bind(&asset.path)
            .bind(&asset.mime_type)
            .bind(asset.scene_index)
            .bind(asset.created_at.to_rfc3339())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn save_provider_credential(&self, input: ProviderCredentialInput) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let encrypted_key = encrypt_secret(&input.api_key)?;
        sqlx::query("INSERT INTO provider_credentials VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(Uuid::new_v4().to_string())
            .bind(input.provider)
            .bind(input.label)
            .bind(encrypted_key)
            .bind(input.base_url)
            .bind(input.model)
            .bind(&now)
            .bind(&now)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn insert_log(
        &self,
        task_id: Option<&str>,
        level: &str,
        message: &str,
    ) -> AppResult<()> {
        sqlx::query("INSERT INTO logs VALUES (?, ?, NULL, ?, ?, NULL, ?)")
            .bind(Uuid::new_v4().to_string())
            .bind(task_id)
            .bind(level)
            .bind(message)
            .bind(Utc::now().to_rfc3339())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn update_run_stage(
        &self,
        run_id: &str,
        stage: Option<StageType>,
        status: RunStatus,
        error: Option<&str>,
    ) -> AppResult<()> {
        sqlx::query("UPDATE runs SET status = ?, current_stage = ?, error = ?, finished_at = ? WHERE id = ?")
            .bind(run_status_text(&status))
            .bind(stage.as_ref().map(stage_type_text))
            .bind(error)
            .bind(finished_at(&status))
            .bind(run_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

async fn insert_task(pool: &SqlitePool, task: &Task) -> AppResult<()> {
    sqlx::query("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(&task.id)
        .bind(&task.title)
        .bind(&task.source_path)
        .bind(status_text(&task.status))
        .bind(task.config_json.to_string())
        .bind(task.created_at.to_rfc3339())
        .bind(task.updated_at.to_rfc3339())
        .execute(pool)
        .await?;
    Ok(())
}

fn row_to_task(row: sqlx::sqlite::SqliteRow) -> AppResult<Task> {
    let config: String = row.try_get("config_json")?;
    Ok(Task {
        id: row.try_get("id")?,
        title: row.try_get("title")?,
        source_path: row.try_get("source_path")?,
        status: parse_task_status(row.try_get::<String, _>("status")?),
        config_json: serde_json::from_str::<Value>(&config)?,
        created_at: parse_time(row.try_get::<String, _>("created_at")?)?,
        updated_at: parse_time(row.try_get::<String, _>("updated_at")?)?,
    })
}

fn row_to_asset(row: sqlx::sqlite::SqliteRow) -> AppResult<Asset> {
    Ok(Asset {
        id: row.try_get("id")?,
        task_id: row.try_get("task_id")?,
        run_id: row.try_get("run_id")?,
        asset_type: parse_asset_type(row.try_get::<String, _>("asset_type")?),
        path: row.try_get("path")?,
        mime_type: row.try_get("mime_type")?,
        scene_index: row.try_get("scene_index")?,
        created_at: parse_time(row.try_get::<String, _>("created_at")?)?,
    })
}

fn status_text(status: &TaskStatus) -> &'static str {
    match status {
        TaskStatus::Draft => "draft",
        TaskStatus::Running => "running",
        TaskStatus::Completed => "completed",
        TaskStatus::Failed => "failed",
        TaskStatus::Canceled => "canceled",
    }
}

fn run_status_text(status: &RunStatus) -> &'static str {
    match status {
        RunStatus::Running => "running",
        RunStatus::Completed => "completed",
        RunStatus::Failed => "failed",
        RunStatus::Canceled => "canceled",
    }
}

fn stage_status_text(status: &StageStatus) -> &'static str {
    match status {
        StageStatus::Pending => "pending",
        StageStatus::Running => "running",
        StageStatus::Completed => "completed",
        StageStatus::Failed => "failed",
        StageStatus::Canceled => "canceled",
    }
}

fn stage_type_text(stage: &StageType) -> &'static str {
    match stage {
        StageType::TranscriptExtraction => "transcript_extraction",
        StageType::ScriptRewrite => "script_rewrite",
        StageType::StoryboardGeneration => "storyboard_generation",
        StageType::SegmentGeneration => "segment_generation",
        StageType::FinalRender => "final_render",
    }
}

fn finished_at(status: &RunStatus) -> Option<String> {
    match status {
        RunStatus::Running => None,
        _ => Some(Utc::now().to_rfc3339()),
    }
}

fn parse_task_status(value: String) -> TaskStatus {
    match value.as_str() {
        "running" => TaskStatus::Running,
        "completed" => TaskStatus::Completed,
        "failed" => TaskStatus::Failed,
        "canceled" => TaskStatus::Canceled,
        _ => TaskStatus::Draft,
    }
}

fn parse_asset_type(value: String) -> AssetType {
    match value.as_str() {
        "audio" => AssetType::Audio,
        "keyframe" => AssetType::Keyframe,
        "generated_frame" => AssetType::GeneratedFrame,
        "video_segment" => AssetType::VideoSegment,
        "subtitle" => AssetType::Subtitle,
        "final_video" => AssetType::FinalVideo,
        _ => AssetType::SourceVideo,
    }
}

fn asset_type_text(asset_type: &AssetType) -> &'static str {
    match asset_type {
        AssetType::SourceVideo => "source_video",
        AssetType::Audio => "audio",
        AssetType::Keyframe => "keyframe",
        AssetType::GeneratedFrame => "generated_frame",
        AssetType::VideoSegment => "video_segment",
        AssetType::Subtitle => "subtitle",
        AssetType::FinalVideo => "final_video",
    }
}

fn parse_time(value: String) -> AppResult<chrono::DateTime<Utc>> {
    let parsed = chrono::DateTime::parse_from_rfc3339(&value)
        .map_err(|error| crate::errors::AppError::Database(sqlx::Error::Decode(Box::new(error))))?;
    Ok(parsed.with_timezone(&Utc))
}
