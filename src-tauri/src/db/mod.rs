use std::collections::HashMap;

use chrono::{DateTime, Duration, Utc};
use serde_json::Value;
use sqlx::{sqlite::SqliteConnectOptions, Executor, Row, SqlitePool};
use uuid::Uuid;

use crate::errors::AppResult;
use crate::models::{
    AppLog, Asset, AssetStatus, AssetType, CostSummary, CreateTaskInput, DashboardData,
    DashboardStats, DashboardSummary, DashscopeCredentialInput, DashscopeCredentialView,
    PipelineRun, PipelineStage, ProviderCostSummary, ProviderCredentialConfig,
    ProviderCredentialInput, ProviderCredentialView, ProviderListingCredentials, ProviderSettings,
    QueueItem, RunDetail, RunDetailLog, RunDetailStage, RunListItem, RunStatus, Scene, StageStatus,
    StageType, Task, TaskStatus, TrendPoint, UsageItem, WorkflowTaskType,
};
use crate::secrets::{decrypt_secret, encrypt_secret, mask_secret};
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
        run_pending_migrations(&pool).await?;
        fail_stale_running_runs(&pool).await?;
        Ok(Self { pool })
    }

    pub async fn create_task(&self, input: CreateTaskInput) -> AppResult<Task> {
        let now = Utc::now();
        let task_type = workflow_task_type_from_config(&input.config_json);
        let task = Task {
            id: Uuid::new_v4().to_string(),
            title: input.title,
            source_path: input.source_path,
            task_type,
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

    pub async fn dashboard_summary(&self) -> AppResult<DashboardSummary> {
        Ok(DashboardSummary {
            total_tasks: self.count_tasks(None).await?,
            running_tasks: self.count_tasks(Some("running")).await?,
            completed_tasks: self.count_tasks(Some("completed")).await?,
            failed_tasks: self.count_tasks(Some("failed")).await?,
            canceled_tasks: self.count_tasks(Some("canceled")).await?,
            draft_tasks: self.count_tasks(Some("draft")).await?,
            videos_today: self.count_videos_today().await?,
            asset_count: self.count_assets().await?,
            latest_tasks: self.latest_tasks().await?,
        })
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
        let now = Utc::now();
        let run = PipelineRun {
            id: Uuid::new_v4().to_string(),
            task_id: task_id.to_string(),
            status: RunStatus::Running,
            current_stage: None,
            error: None,
            started_at: Some(now),
            finished_at: None,
            created_at: Some(now),
        };
        let mut transaction = self.pool.begin().await?;
        let result = sqlx::query(
            "INSERT INTO runs (id, task_id, status, current_stage, error, started_at, finished_at, created_at) \
             SELECT ?, ?, ?, NULL, NULL, ?, NULL, ? \
             WHERE NOT EXISTS (SELECT 1 FROM runs WHERE task_id = ? AND status = ?)",
        )
        .bind(&run.id)
        .bind(&run.task_id)
        .bind(run_status_text(&run.status))
        .bind(run.started_at.map(|value| value.to_rfc3339()))
        .bind(run.created_at.map(|value| value.to_rfc3339()))
        .bind(task_id)
        .bind(run_status_text(&RunStatus::Running))
        .execute(&mut *transaction)
        .await?;
        if result.rows_affected() == 0 {
            return Err(crate::errors::AppError::Workflow(
                "task already has an active run".into(),
            ));
        }
        let task_update = sqlx::query("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?")
            .bind(status_text(&TaskStatus::Running))
            .bind(now.to_rfc3339())
            .bind(task_id)
            .execute(&mut *transaction)
            .await?;
        if task_update.rows_affected() == 0 {
            return Err(crate::errors::AppError::Workflow(format!(
                "task not found: {task_id}"
            )));
        }
        transaction.commit().await?;
        Ok(run)
    }

    pub async fn fail_run_startup(
        &self,
        run_id: &str,
        task_id: &str,
        error: &str,
    ) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.pool.begin().await?;
        let result = sqlx::query(
            "UPDATE runs SET status = ?, error = ?, finished_at = ? WHERE id = ? AND status = ?",
        )
        .bind(run_status_text(&RunStatus::Failed))
        .bind(error)
        .bind(&now)
        .bind(run_id)
        .bind(run_status_text(&RunStatus::Running))
        .execute(&mut *transaction)
        .await?;
        if result.rows_affected() > 0 {
            sqlx::query("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND status = ?")
                .bind(status_text(&TaskStatus::Failed))
                .bind(&now)
                .bind(task_id)
                .bind(status_text(&TaskStatus::Running))
                .execute(&mut *transaction)
                .await?;
        }
        sqlx::query(
            "INSERT INTO logs (id, task_id, run_id, level, message, context_json, created_at) \
             VALUES (?, ?, ?, ?, ?, NULL, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(task_id)
        .bind(run_id)
        .bind("error")
        .bind(error)
        .bind(&now)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(())
    }

    pub async fn get_run(&self, run_id: &str) -> AppResult<Option<RunDetail>> {
        let row = sqlx::query("SELECT * FROM runs WHERE id = ?")
            .bind(run_id)
            .fetch_optional(&self.pool)
            .await?;
        let Some(row) = row else {
            return Ok(None);
        };
        let run = row_to_run(row)?;
        let task = self
            .get_task(&run.task_id)
            .await?
            .ok_or_else(|| crate::errors::AppError::Workflow("task not found for run".into()))?;
        let stages = self.list_run_stages(run_id).await?;
        let logs = self.list_run_logs(run_id, 200).await?;
        Ok(Some(RunDetail {
            id: run.id,
            task_id: run.task_id,
            task_title: task.title,
            status: display_run_status(&run.status),
            current_stage: run.current_stage.as_ref().map(display_stage_type),
            error: run.error,
            started_at: run.started_at.map(|value| value.to_rfc3339()),
            finished_at: run.finished_at.map(|value| value.to_rfc3339()),
            created_at: run
                .created_at
                .or(run.started_at)
                .map(|value| value.to_rfc3339()),
            stages: stages
                .into_iter()
                .map(|stage| RunDetailStage {
                    stage_type: display_stage_type(&stage.stage_type),
                    status: display_stage_status(&stage.status),
                    error: stage.error,
                    order_index: stage.order_index.unwrap_or(0),
                })
                .collect(),
            logs: logs
                .into_iter()
                .map(|log| RunDetailLog {
                    ts: log.created_at.format("%H:%M:%S").to_string(),
                    level: log.level.to_uppercase(),
                    message: log.message,
                })
                .collect(),
        }))
    }

    pub async fn list_runs(&self, limit: i64) -> AppResult<Vec<RunListItem>> {
        let rows = sqlx::query(
            "SELECT runs.*, tasks.title AS task_title FROM runs \
             INNER JOIN tasks ON tasks.id = runs.task_id \
             ORDER BY COALESCE(runs.created_at, runs.started_at) DESC LIMIT ?",
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(row_to_run_list_item).collect()
    }

    pub async fn dashboard_data(&self) -> AppResult<DashboardData> {
        let tasks = self.list_tasks().await?;
        let mut status_count = HashMap::new();
        for task in &tasks {
            let latest = self.latest_run(&task.id).await?;
            let status = latest
                .as_ref()
                .map(|run| display_run_status(&run.status))
                .unwrap_or_else(|| display_task_status(&task.status));
            *status_count.entry(status).or_insert(0) += 1;
        }

        let total_tasks = tasks.len() as i64;
        let running = *status_count.get("RUNNING").unwrap_or(&0);
        let completed = *status_count.get("COMPLETED").unwrap_or(&0);
        let success_rate = if total_tasks > 0 {
            (completed * 100) / total_tasks
        } else {
            0
        };
        let assets_ready = self.count_assets_by_status("ready").await?;

        let trend = self.trend_last_7_days().await?;
        let queue = self.recent_queue(6).await?;
        let usage = self.usage_by_provider().await?;

        Ok(DashboardData {
            stats: DashboardStats {
                total_tasks,
                running,
                completed,
                success_rate,
                assets_ready,
            },
            status_count,
            trend,
            queue,
            usage,
        })
    }

    pub async fn get_provider_settings(&self, provider: &str) -> AppResult<ProviderSettings> {
        let row = sqlx::query(
            "SELECT encrypted_key, base_url, model FROM provider_credentials \
             WHERE UPPER(provider) = ? ORDER BY updated_at DESC LIMIT 1",
        )
        .bind(provider.to_uppercase())
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else {
            return Err(crate::errors::AppError::Provider(format!(
                "{provider} API key not configured"
            )));
        };
        let encrypted_key: String = row.try_get("encrypted_key")?;
        let api_key = decrypt_secret(&encrypted_key)?;
        let base_url: String = row
            .try_get::<Option<String>, _>("base_url")?
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| default_provider_base_url(provider).to_string());
        let model: Option<String> = row.try_get("model")?;
        let model = model
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                crate::errors::AppError::Provider(format!(
                    "{provider} model not configured. Please set it in Settings."
                ))
            })?;
        Ok(ProviderSettings {
            api_key,
            base_url,
            model,
        })
    }

    pub async fn get_provider_listing_credentials(
        &self,
        provider: &str,
    ) -> AppResult<ProviderListingCredentials> {
        let row = sqlx::query(
            "SELECT encrypted_key, base_url FROM provider_credentials \
             WHERE UPPER(provider) = ? ORDER BY updated_at DESC LIMIT 1",
        )
        .bind(provider.to_uppercase())
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else {
            return Err(crate::errors::AppError::Provider(format!(
                "{provider} API key not configured."
            )));
        };
        let encrypted_key: String = row.try_get("encrypted_key")?;
        let api_key = decrypt_secret(&encrypted_key)?;
        if api_key.trim().is_empty() {
            return Err(crate::errors::AppError::Provider(format!(
                "{provider} API key not configured."
            )));
        }
        let base_url: String = row
            .try_get::<Option<String>, _>("base_url")?
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| default_provider_base_url(provider).to_string());
        Ok(ProviderListingCredentials { api_key, base_url })
    }

    pub async fn list_dashscope_credentials(&self) -> AppResult<DashscopeCredentialView> {
        const PROVIDERS: [&str; 3] = ["QWEN_VL", "TONGYI", "COSYVOICE"];
        let mut rows = Vec::new();
        for provider in PROVIDERS {
            let row = sqlx::query(
                "SELECT encrypted_key, base_url, model FROM provider_credentials \
                 WHERE UPPER(provider) = ? ORDER BY updated_at DESC LIMIT 1",
            )
            .bind(provider)
            .fetch_optional(&self.pool)
            .await?;
            rows.push((provider, row));
        }

        let mut decrypted_keys: Vec<Option<String>> = Vec::new();
        let mut key_decrypt_failed = false;
        for (_, row) in &rows {
            let Some(row) = row else {
                decrypted_keys.push(None);
                continue;
            };
            let encrypted_key: String = row.try_get("encrypted_key")?;
            match decrypt_secret(&encrypted_key) {
                Ok(decrypted) => decrypted_keys.push(Some(decrypted)),
                Err(_) => {
                    key_decrypt_failed = true;
                    decrypted_keys.push(None);
                }
            }
        }

        let primary_masked = rows
            .iter()
            .zip(decrypted_keys.iter())
            .find_map(|((_, row), decrypted)| {
                row.as_ref()
                    .and_then(|_| decrypted.as_ref().map(|value| mask_secret(value)))
            })
            .unwrap_or_default();

        let keys_mismatch = decrypted_keys
            .iter()
            .filter_map(|value| value.as_ref())
            .collect::<Vec<_>>()
            .windows(2)
            .any(|pair| pair[0] != pair[1]);

        let base_url = rows.iter().find_map(|(_, row)| {
            row.as_ref().and_then(|row| {
                row.try_get::<Option<String>, _>("base_url")
                    .ok()
                    .flatten()
                    .filter(|value| !value.trim().is_empty())
            })
        });

        let model_for = |index: usize| -> Option<String> {
            rows.get(index).and_then(|(_, row)| {
                row.as_ref().and_then(|row| {
                    row.try_get::<Option<String>, _>("model")
                        .ok()
                        .flatten()
                        .filter(|value| !value.trim().is_empty())
                })
            })
        };

        Ok(DashscopeCredentialView {
            masked_key: primary_masked,
            key_decrypt_failed,
            keys_mismatch,
            base_url,
            qwen_vl_model: model_for(0),
            tongyi_model: model_for(1),
            cosyvoice_model: model_for(2),
        })
    }

    pub async fn save_dashscope_credential(
        &self,
        input: DashscopeCredentialInput,
    ) -> AppResult<()> {
        let base_url = if input.base_url.trim().is_empty() {
            default_provider_base_url("QWEN_VL").to_string()
        } else {
            input.base_url.trim().to_string()
        };
        let entries = [
            ("QWEN_VL", input.qwen_vl_model.as_str()),
            ("TONGYI", input.tongyi_model.as_str()),
            ("COSYVOICE", input.cosyvoice_model.as_str()),
        ];
        for (provider, model) in entries {
            self.save_provider_credential(ProviderCredentialInput {
                provider: provider.to_string(),
                label: "default".to_string(),
                api_key: input.api_key.clone(),
                base_url: base_url.clone(),
                model: model.to_string(),
            })
            .await?;
        }
        Ok(())
    }

    pub async fn list_provider_credentials(&self) -> AppResult<Vec<ProviderCredentialView>> {
        const PROVIDERS: [&str; 2] = ["DEEPSEEK", "SEEDANCE"];
        let mut views = Vec::new();
        for provider in PROVIDERS {
            let row = sqlx::query(
                "SELECT encrypted_key, base_url, model FROM provider_credentials \
                 WHERE UPPER(provider) = ? ORDER BY updated_at DESC LIMIT 1",
            )
            .bind(provider)
            .fetch_optional(&self.pool)
            .await?;
            let Some(row) = row else {
                views.push(ProviderCredentialView {
                    provider: provider.to_string(),
                    masked_key: String::new(),
                    key_decrypt_failed: false,
                    config: None,
                });
                continue;
            };
            let encrypted_key: String = row.try_get("encrypted_key")?;
            let (masked_key, key_decrypt_failed) = match decrypt_secret(&encrypted_key) {
                Ok(decrypted) => (mask_secret(&decrypted), false),
                Err(_) => ("****".to_string(), true),
            };
            views.push(ProviderCredentialView {
                provider: provider.to_string(),
                masked_key,
                key_decrypt_failed,
                config: Some(ProviderCredentialConfig {
                    base_url: row.try_get("base_url")?,
                    model: row.try_get("model")?,
                }),
            });
        }
        Ok(views)
    }

    pub async fn get_task_cost_summary(&self, task_id: &str) -> AppResult<CostSummary> {
        let rows = sqlx::query(
            "SELECT provider, unit, quantity, cost_usd, success FROM api_usage_logs \
             WHERE task_id = ? ORDER BY created_at ASC",
        )
        .bind(task_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(summarize_usage_rows(&rows))
    }

    pub async fn get_run_cost_summary(&self, run_id: &str) -> AppResult<CostSummary> {
        let row = sqlx::query("SELECT task_id FROM runs WHERE id = ?")
            .bind(run_id)
            .fetch_optional(&self.pool)
            .await?;
        let Some(row) = row else {
            return Ok(empty_cost_summary());
        };
        let task_id: String = row.try_get("task_id")?;
        self.get_task_cost_summary(&task_id).await
    }

    pub async fn run_task_id(&self, run_id: &str) -> AppResult<String> {
        let task_id: Option<String> = sqlx::query_scalar("SELECT task_id FROM runs WHERE id = ?")
            .bind(run_id)
            .fetch_optional(&self.pool)
            .await?;
        task_id.ok_or_else(|| crate::errors::AppError::Workflow(format!("run not found: {run_id}")))
    }

    pub async fn latest_run(&self, task_id: &str) -> AppResult<Option<PipelineRun>> {
        let row =
            sqlx::query("SELECT * FROM runs WHERE task_id = ? ORDER BY started_at DESC LIMIT 1")
                .bind(task_id)
                .fetch_optional(&self.pool)
                .await?;
        row.map(row_to_run).transpose()
    }

    pub async fn start_stage(
        &self,
        run_id: &str,
        stage: StageType,
        order_index: i32,
    ) -> AppResult<bool> {
        let mut transaction = self.pool.begin().await?;
        let active = sqlx::query("UPDATE runs SET current_stage = ? WHERE id = ? AND status = ?")
            .bind(stage_type_text(&stage))
            .bind(run_id)
            .bind(run_status_text(&RunStatus::Running))
            .execute(&mut *transaction)
            .await?;
        if active.rows_affected() == 0 {
            return Ok(false);
        }
        sqlx::query(
            "INSERT INTO stages (id, run_id, stage_type, status, error, order_index, started_at, finished_at) \
             VALUES (?, ?, ?, ?, NULL, ?, ?, NULL)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(run_id)
        .bind(stage_type_text(&stage))
        .bind(stage_status_text(&StageStatus::Running))
        .bind(order_index)
        .bind(Utc::now().to_rfc3339())
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(true)
    }

    pub async fn complete_stage(&self, run_id: &str, stage: StageType) -> AppResult<bool> {
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.pool.begin().await?;
        let active = sqlx::query("UPDATE runs SET current_stage = ? WHERE id = ? AND status = ?")
            .bind(stage_type_text(&stage))
            .bind(run_id)
            .bind(run_status_text(&RunStatus::Running))
            .execute(&mut *transaction)
            .await?;
        if active.rows_affected() == 0 {
            return Ok(false);
        }
        let stage_update = sqlx::query(
            "UPDATE stages SET status = ?, finished_at = ? \
             WHERE run_id = ? AND stage_type = ? AND status = ?",
        )
        .bind(stage_status_text(&StageStatus::Completed))
        .bind(&now)
        .bind(run_id)
        .bind(stage_type_text(&stage))
        .bind(stage_status_text(&StageStatus::Running))
        .execute(&mut *transaction)
        .await?;
        if stage_update.rows_affected() == 0 {
            return Err(crate::errors::AppError::Workflow(format!(
                "running stage not found: {}",
                stage_type_text(&stage)
            )));
        }
        transaction.commit().await?;
        Ok(true)
    }

    pub async fn fail_run_if_active(
        &self,
        run_id: &str,
        task_id: &str,
        stage: StageType,
        error: &str,
    ) -> AppResult<bool> {
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.pool.begin().await?;
        let active = sqlx::query(
            "UPDATE runs SET status = ?, current_stage = ?, error = ?, finished_at = ? \
             WHERE id = ? AND task_id = ? AND status = ?",
        )
        .bind(run_status_text(&RunStatus::Failed))
        .bind(stage_type_text(&stage))
        .bind(error)
        .bind(&now)
        .bind(run_id)
        .bind(task_id)
        .bind(run_status_text(&RunStatus::Running))
        .execute(&mut *transaction)
        .await?;
        if active.rows_affected() == 0 {
            return Ok(false);
        }
        sqlx::query(
            "UPDATE stages SET status = ?, error = ?, finished_at = ? \
             WHERE run_id = ? AND stage_type = ? AND status = ?",
        )
        .bind(stage_status_text(&StageStatus::Failed))
        .bind(error)
        .bind(&now)
        .bind(run_id)
        .bind(stage_type_text(&stage))
        .bind(stage_status_text(&StageStatus::Running))
        .execute(&mut *transaction)
        .await?;
        let task_update =
            sqlx::query("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND status = ?")
                .bind(status_text(&TaskStatus::Failed))
                .bind(&now)
                .bind(task_id)
                .bind(status_text(&TaskStatus::Running))
                .execute(&mut *transaction)
                .await?;
        if task_update.rows_affected() == 0 {
            return Err(crate::errors::AppError::Workflow(format!(
                "active task not found for run: {run_id}"
            )));
        }
        transaction.commit().await?;
        Ok(true)
    }

    pub async fn complete_run_if_active(&self, run_id: &str, task_id: &str) -> AppResult<bool> {
        self.finish_run_if_active(run_id, task_id, RunStatus::Completed, TaskStatus::Completed)
            .await
    }

    pub async fn cancel_active_run(&self, run_id: &str, task_id: &str) -> AppResult<bool> {
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.pool.begin().await?;
        let active = sqlx::query(
            "UPDATE runs SET status = ?, current_stage = NULL, finished_at = ? \
             WHERE id = ? AND task_id = ? AND status = ?",
        )
        .bind(run_status_text(&RunStatus::Canceled))
        .bind(&now)
        .bind(run_id)
        .bind(task_id)
        .bind(run_status_text(&RunStatus::Running))
        .execute(&mut *transaction)
        .await?;
        if active.rows_affected() == 0 {
            return Ok(false);
        }
        sqlx::query(
            "UPDATE stages SET status = ?, finished_at = ? WHERE run_id = ? AND status = ?",
        )
        .bind(stage_status_text(&StageStatus::Canceled))
        .bind(&now)
        .bind(run_id)
        .bind(stage_status_text(&StageStatus::Running))
        .execute(&mut *transaction)
        .await?;
        let task_update =
            sqlx::query("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND status = ?")
                .bind(status_text(&TaskStatus::Canceled))
                .bind(&now)
                .bind(task_id)
                .bind(status_text(&TaskStatus::Running))
                .execute(&mut *transaction)
                .await?;
        if task_update.rows_affected() == 0 {
            return Err(crate::errors::AppError::Workflow(format!(
                "active task not found for run: {run_id}"
            )));
        }
        transaction.commit().await?;
        Ok(true)
    }

    pub async fn run_is_active(&self, run_id: &str) -> AppResult<bool> {
        let status: Option<String> = sqlx::query_scalar("SELECT status FROM runs WHERE id = ?")
            .bind(run_id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(status.as_deref() == Some(run_status_text(&RunStatus::Running)))
    }

    pub async fn insert_scene(&self, scene: &Scene) -> AppResult<()> {
        sqlx::query(
            "INSERT INTO scenes (id, task_id, run_id, scene_index, script, prompt, visual_prompt, motion_prompt, metadata_json, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&scene.id)
        .bind(&scene.task_id)
        .bind(&scene.run_id)
        .bind(scene.scene_index)
        .bind(&scene.script_text)
        .bind(scene.visual_prompt.as_deref())
        .bind(scene.visual_prompt.as_deref())
        .bind(scene.motion_prompt.as_deref())
        .bind(
            scene
                .metadata_json
                .as_ref()
                .map(|value| value.to_string()),
        )
        .bind(scene.created_at.to_rfc3339())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn update_scene_metadata(
        &self,
        scene_id: &str,
        metadata_json: &serde_json::Value,
    ) -> AppResult<()> {
        sqlx::query("UPDATE scenes SET metadata_json = ? WHERE id = ?")
            .bind(metadata_json.to_string())
            .bind(scene_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn delete_scenes_for_run(&self, run_id: &str) -> AppResult<()> {
        sqlx::query("DELETE FROM scenes WHERE run_id = ?")
            .bind(run_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn list_scenes(&self, run_id: &str) -> AppResult<Vec<Scene>> {
        let rows = sqlx::query("SELECT * FROM scenes WHERE run_id = ? ORDER BY scene_index ASC")
            .bind(run_id)
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(row_to_scene).collect()
    }

    pub async fn list_scenes_for_task(&self, task_id: &str) -> AppResult<Vec<Scene>> {
        let rows = sqlx::query(
            "SELECT * FROM scenes WHERE task_id = ? ORDER BY created_at DESC, scene_index ASC",
        )
        .bind(task_id)
        .fetch_all(&self.pool)
        .await?;
        let mut scenes = rows
            .into_iter()
            .map(row_to_scene)
            .collect::<AppResult<Vec<_>>>()?;
        if scenes.is_empty() {
            return Ok(scenes);
        }
        let latest_run_id = scenes[0].run_id.clone();
        scenes.retain(|scene| scene.run_id == latest_run_id);
        scenes.sort_by_key(|scene| scene.scene_index);
        Ok(scenes)
    }

    pub async fn count_scenes(&self, run_id: &str) -> AppResult<i64> {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM scenes WHERE run_id = ?")
            .bind(run_id)
            .fetch_one(&self.pool)
            .await?;
        Ok(count)
    }

    pub async fn insert_api_usage_log(
        &self,
        provider: &str,
        task_id: Option<&str>,
        run_id: Option<&str>,
        endpoint: &str,
        unit: &str,
        quantity: f64,
        cost_usd: Option<f64>,
        success: bool,
    ) -> AppResult<()> {
        sqlx::query(
            "INSERT INTO api_usage_logs (id, provider, task_id, run_id, endpoint, unit, quantity, cost_usd, success, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(provider)
        .bind(task_id)
        .bind(run_id)
        .bind(endpoint)
        .bind(unit)
        .bind(quantity)
        .bind(cost_usd)
        .bind(if success { 1 } else { 0 })
        .bind(Utc::now().to_rfc3339())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn has_task_asset(&self, task_id: &str, asset_type: AssetType) -> AppResult<bool> {
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM assets WHERE task_id = ? AND asset_type = ?")
                .bind(task_id)
                .bind(asset_type_text(&asset_type))
                .fetch_one(&self.pool)
                .await?;
        Ok(count > 0)
    }

    pub async fn list_assets(&self, task_id: &str) -> AppResult<Vec<Asset>> {
        let rows = sqlx::query("SELECT * FROM assets WHERE task_id = ? ORDER BY created_at ASC")
            .bind(task_id)
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(row_to_asset).collect()
    }

    pub async fn list_all_assets(&self, task_id: Option<&str>) -> AppResult<Vec<Asset>> {
        let rows = match task_id {
            Some(id) => {
                sqlx::query("SELECT * FROM assets WHERE task_id = ? ORDER BY created_at DESC")
                    .bind(id)
                    .fetch_all(&self.pool)
                    .await?
            }
            None => {
                sqlx::query("SELECT * FROM assets ORDER BY created_at DESC")
                    .fetch_all(&self.pool)
                    .await?
            }
        };
        rows.into_iter().map(row_to_asset).collect()
    }

    pub async fn list_run_stages(&self, run_id: &str) -> AppResult<Vec<PipelineStage>> {
        let rows = sqlx::query(
            "SELECT * FROM stages WHERE run_id = ? ORDER BY COALESCE(order_index, 0) ASC, started_at ASC",
        )
        .bind(run_id)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(row_to_stage).collect()
    }

    pub async fn list_run_logs(&self, run_id: &str, limit: i64) -> AppResult<Vec<AppLog>> {
        let rows =
            sqlx::query("SELECT * FROM logs WHERE run_id = ? ORDER BY created_at ASC LIMIT ?")
                .bind(run_id)
                .bind(limit)
                .fetch_all(&self.pool)
                .await?;
        rows.into_iter().map(row_to_log).collect()
    }

    pub async fn list_logs(&self, task_id: &str) -> AppResult<Vec<AppLog>> {
        let rows =
            sqlx::query("SELECT * FROM logs WHERE task_id = ? ORDER BY created_at DESC LIMIT 200")
                .bind(task_id)
                .fetch_all(&self.pool)
                .await?;
        rows.into_iter().map(row_to_log).collect()
    }

    pub async fn insert_asset(&self, asset: &Asset) -> AppResult<()> {
        let status = asset
            .status
            .as_ref()
            .map(asset_status_text)
            .unwrap_or("ready");
        sqlx::query(
            "INSERT INTO assets (id, task_id, run_id, asset_type, path, mime_type, scene_index, status, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&asset.id)
        .bind(&asset.task_id)
        .bind(&asset.run_id)
        .bind(asset_type_text(&asset.asset_type))
        .bind(&asset.path)
        .bind(&asset.mime_type)
        .bind(asset.scene_index)
        .bind(status)
        .bind(asset.created_at.to_rfc3339())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn save_provider_credential(&self, input: ProviderCredentialInput) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let provider = input.provider.to_uppercase();
        let existing = sqlx::query(
            "SELECT id, encrypted_key FROM provider_credentials WHERE provider = ? AND label = ?",
        )
        .bind(&provider)
        .bind(&input.label)
        .fetch_optional(&self.pool)
        .await?;
        let encrypted_key = if input.api_key.trim().is_empty() {
            let Some(row) = &existing else {
                return Err(crate::errors::AppError::Provider(
                    "API key is required".into(),
                ));
            };
            row.try_get("encrypted_key")?
        } else {
            encrypt_secret(&input.api_key)?
        };
        if let Some(row) = existing {
            let id: String = row.try_get("id")?;
            sqlx::query(
                "UPDATE provider_credentials SET encrypted_key = ?, base_url = ?, model = ?, updated_at = ? WHERE id = ?",
            )
            .bind(encrypted_key)
            .bind(input.base_url)
            .bind(input.model)
            .bind(&now)
            .bind(id)
            .execute(&self.pool)
            .await?;
        } else {
            sqlx::query("INSERT INTO provider_credentials VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(Uuid::new_v4().to_string())
                .bind(provider)
                .bind(input.label)
                .bind(encrypted_key)
                .bind(input.base_url)
                .bind(input.model)
                .bind(&now)
                .bind(&now)
                .execute(&self.pool)
                .await?;
        }
        Ok(())
    }

    pub async fn insert_log(
        &self,
        task_id: Option<&str>,
        run_id: Option<&str>,
        level: &str,
        message: &str,
    ) -> AppResult<()> {
        sqlx::query(
            "INSERT INTO logs (id, task_id, run_id, level, message, context_json, created_at) \
             VALUES (?, ?, ?, ?, ?, NULL, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(task_id)
        .bind(run_id)
        .bind(level)
        .bind(message)
        .bind(Utc::now().to_rfc3339())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn finish_run_if_active(
        &self,
        run_id: &str,
        task_id: &str,
        run_status: RunStatus,
        task_status: TaskStatus,
    ) -> AppResult<bool> {
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.pool.begin().await?;
        let run_update = sqlx::query(
            "UPDATE runs SET status = ?, current_stage = NULL, error = NULL, finished_at = ? \
             WHERE id = ? AND task_id = ? AND status = ?",
        )
        .bind(run_status_text(&run_status))
        .bind(&now)
        .bind(run_id)
        .bind(task_id)
        .bind(run_status_text(&RunStatus::Running))
        .execute(&mut *transaction)
        .await?;
        if run_update.rows_affected() == 0 {
            return Ok(false);
        }
        let task_update =
            sqlx::query("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND status = ?")
                .bind(status_text(&task_status))
                .bind(&now)
                .bind(task_id)
                .bind(status_text(&TaskStatus::Running))
                .execute(&mut *transaction)
                .await?;
        if task_update.rows_affected() == 0 {
            return Err(crate::errors::AppError::Workflow(format!(
                "active task not found for run: {run_id}"
            )));
        }
        transaction.commit().await?;
        Ok(true)
    }

    async fn count_tasks(&self, status: Option<&str>) -> AppResult<i64> {
        let query = match status {
            Some(_) => sqlx::query("SELECT COUNT(*) FROM tasks WHERE status = ?").bind(status),
            None => sqlx::query("SELECT COUNT(*) FROM tasks"),
        };
        let count: i64 = query.fetch_one(&self.pool).await?.try_get(0)?;
        Ok(count)
    }

    async fn count_assets(&self) -> AppResult<i64> {
        let count: i64 = sqlx::query("SELECT COUNT(*) FROM assets")
            .fetch_one(&self.pool)
            .await?
            .try_get(0)?;
        Ok(count)
    }

    async fn count_videos_today(&self) -> AppResult<i64> {
        let today = Utc::now().format("%Y-%m-%d").to_string();
        let count: i64 = sqlx::query(
            "SELECT COUNT(*) FROM tasks WHERE status = 'completed' AND date(updated_at) = ?",
        )
        .bind(&today)
        .fetch_one(&self.pool)
        .await?
        .try_get(0)?;
        Ok(count)
    }

    async fn latest_tasks(&self) -> AppResult<Vec<Task>> {
        let rows = sqlx::query("SELECT * FROM tasks ORDER BY created_at DESC LIMIT 6")
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(row_to_task).collect()
    }

    async fn count_assets_by_status(&self, status: &str) -> AppResult<i64> {
        let count: i64 = sqlx::query("SELECT COUNT(*) FROM assets WHERE status = ?")
            .bind(status)
            .fetch_one(&self.pool)
            .await?
            .try_get(0)?;
        Ok(count)
    }

    async fn trend_last_7_days(&self) -> AppResult<Vec<TrendPoint>> {
        let now = Utc::now();
        let mut trend = Vec::with_capacity(7);
        for offset in (0..7).rev() {
            let day_start = (now - Duration::days(offset))
                .date_naive()
                .and_hms_opt(0, 0, 0)
                .expect("valid day start");
            let day_start = DateTime::<Utc>::from_naive_utc_and_offset(day_start, Utc);
            let day_end = day_start + Duration::days(1);
            let count: i64 = sqlx::query(
                "SELECT COUNT(*) FROM runs WHERE finished_at IS NOT NULL \
                 AND finished_at >= ? AND finished_at < ?",
            )
            .bind(day_start.to_rfc3339())
            .bind(day_end.to_rfc3339())
            .fetch_one(&self.pool)
            .await?
            .try_get(0)?;
            trend.push(TrendPoint {
                date: day_start.to_rfc3339(),
                value: count,
            });
        }
        Ok(trend)
    }

    async fn recent_queue(&self, limit: i64) -> AppResult<Vec<QueueItem>> {
        let rows = sqlx::query(
            "SELECT runs.id, runs.status, runs.current_stage, tasks.title, \
             (SELECT COUNT(*) FROM stages WHERE run_id = runs.id AND status = 'completed') AS done_stages, \
             (SELECT COUNT(*) FROM stages WHERE run_id = runs.id) AS total_stages \
             FROM runs INNER JOIN tasks ON tasks.id = runs.task_id \
             ORDER BY COALESCE(runs.created_at, runs.started_at) DESC LIMIT ?",
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                let done: i64 = row.try_get("done_stages")?;
                let total: i64 = row.try_get("total_stages")?;
                let total = total.max(1);
                let current_stage: Option<String> = row.try_get("current_stage")?;
                Ok(QueueItem {
                    id: row.try_get("id")?,
                    title: row.try_get("title")?,
                    status: display_run_status(&parse_run_status(
                        row.try_get::<String, _>("status")?,
                    )),
                    current_stage: current_stage.map(|value| display_stage_type_str(&value)),
                    progress: (done * 100) / total,
                })
            })
            .collect()
    }

    async fn usage_by_provider(&self) -> AppResult<Vec<UsageItem>> {
        let rows = sqlx::query(
            "SELECT provider, COUNT(*) AS calls, COALESCE(SUM(quantity), 0) AS quantity, \
             COALESCE(SUM(cost_usd), 0) AS cost_usd, \
             SUM(CASE WHEN success != 0 AND cost_usd IS NULL THEN 1 ELSE 0 END) AS unknown_cost_count \
             FROM api_usage_logs GROUP BY provider \
             ORDER BY provider ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(UsageItem {
                    provider: row.try_get("provider")?,
                    calls: row.try_get("calls")?,
                    quantity: row.try_get("quantity")?,
                    cost_usd: row.try_get("cost_usd")?,
                    unknown_cost_count: row.try_get("unknown_cost_count")?,
                })
            })
            .collect()
    }
}

async fn run_pending_migrations(pool: &SqlitePool) -> AppResult<()> {
    ensure_column(
        pool,
        "assets",
        "status",
        "ALTER TABLE assets ADD COLUMN status TEXT NOT NULL DEFAULT 'ready'",
    )
    .await?;
    ensure_column(
        pool,
        "stages",
        "order_index",
        "ALTER TABLE stages ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0",
    )
    .await?;
    ensure_column(
        pool,
        "runs",
        "created_at",
        "ALTER TABLE runs ADD COLUMN created_at TEXT",
    )
    .await?;
    sqlx::query("UPDATE runs SET created_at = started_at WHERE created_at IS NULL")
        .execute(pool)
        .await?;

    let migration_applied: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'api_usage_logs'",
    )
    .fetch_one(pool)
    .await?;
    if migration_applied == 0 {
        pool.execute(include_str!("migrations/0002_api_usage.sql"))
            .await?;
        sqlx::query("INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?)")
            .bind(Utc::now().to_rfc3339())
            .execute(pool)
            .await?;
    }

    let scenes_extended: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pragma_table_info('scenes') WHERE name = 'visual_prompt'",
    )
    .fetch_one(pool)
    .await?;
    if scenes_extended == 0 {
        pool.execute(include_str!("migrations/0003_scenes_extend.sql"))
            .await?;
        sqlx::query("INSERT INTO schema_migrations (version, applied_at) VALUES (3, ?)")
            .bind(Utc::now().to_rfc3339())
            .execute(pool)
            .await?;
    }

    ensure_column(
        pool,
        "tasks",
        "task_type",
        "ALTER TABLE tasks ADD COLUMN task_type TEXT NOT NULL DEFAULT 'replicate'",
    )
    .await?;
    Ok(())
}

async fn fail_stale_running_runs(pool: &SqlitePool) -> AppResult<()> {
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "UPDATE stages SET status = ?, finished_at = ? \
         WHERE status = ? AND run_id IN (SELECT id FROM runs WHERE status = ?)",
    )
    .bind(stage_status_text(&StageStatus::Failed))
    .bind(&now)
    .bind(stage_status_text(&StageStatus::Running))
    .bind(run_status_text(&RunStatus::Running))
    .execute(pool)
    .await?;
    sqlx::query("UPDATE runs SET status = ?, error = ?, finished_at = ? WHERE status = ?")
        .bind(run_status_text(&RunStatus::Failed))
        .bind("interrupted by application restart")
        .bind(&now)
        .bind(run_status_text(&RunStatus::Running))
        .execute(pool)
        .await?;
    sqlx::query("UPDATE tasks SET status = ?, updated_at = ? WHERE status = ?")
        .bind(status_text(&TaskStatus::Failed))
        .bind(&now)
        .bind(status_text(&TaskStatus::Running))
        .execute(pool)
        .await?;
    Ok(())
}

async fn ensure_column(pool: &SqlitePool, table: &str, column: &str, ddl: &str) -> AppResult<()> {
    let rows = sqlx::query(&format!("PRAGMA table_info({table})"))
        .fetch_all(pool)
        .await?;
    let exists = rows.iter().any(|row| {
        row.try_get::<String, _>("name")
            .ok()
            .is_some_and(|name| name == column)
    });
    if !exists {
        pool.execute(ddl).await?;
    }
    Ok(())
}

async fn insert_task(pool: &SqlitePool, task: &Task) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO tasks (id, title, source_path, status, config_json, created_at, updated_at, task_type) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&task.id)
    .bind(&task.title)
    .bind(&task.source_path)
    .bind(status_text(&task.status))
    .bind(task.config_json.to_string())
    .bind(task.created_at.to_rfc3339())
    .bind(task.updated_at.to_rfc3339())
    .bind(task_type_text(&task.task_type))
    .execute(pool)
    .await?;
    Ok(())
}

fn row_to_task(row: sqlx::sqlite::SqliteRow) -> AppResult<Task> {
    let config: String = row.try_get("config_json")?;
    let config_json: Value = serde_json::from_str(&config)?;
    let task_type = row
        .try_get::<Option<String>, _>("task_type")
        .ok()
        .flatten()
        .map(|value| parse_task_type(&value))
        .unwrap_or_else(|| workflow_task_type_from_config(&config_json));
    Ok(Task {
        id: row.try_get("id")?,
        title: row.try_get("title")?,
        source_path: row.try_get("source_path")?,
        task_type,
        status: parse_task_status(row.try_get::<String, _>("status")?),
        config_json,
        created_at: parse_time(row.try_get::<String, _>("created_at")?)?,
        updated_at: parse_time(row.try_get::<String, _>("updated_at")?)?,
    })
}

fn row_to_asset(row: sqlx::sqlite::SqliteRow) -> AppResult<Asset> {
    let status: Option<String> = row.try_get("status").ok();
    Ok(Asset {
        id: row.try_get("id")?,
        task_id: row.try_get("task_id")?,
        run_id: row.try_get("run_id")?,
        asset_type: parse_asset_type(row.try_get::<String, _>("asset_type")?),
        path: row.try_get("path")?,
        mime_type: row.try_get("mime_type")?,
        scene_index: row.try_get("scene_index")?,
        status: status.map(parse_asset_status),
        created_at: parse_time(row.try_get::<String, _>("created_at")?)?,
    })
}

fn row_to_scene(row: sqlx::sqlite::SqliteRow) -> AppResult<Scene> {
    let metadata_raw: Option<String> = row.try_get("metadata_json")?;
    let metadata_json = metadata_raw
        .as_deref()
        .map(serde_json::from_str)
        .transpose()?;
    Ok(Scene {
        id: row.try_get("id")?,
        task_id: row.try_get("task_id")?,
        run_id: row.try_get("run_id")?,
        scene_index: row.try_get("scene_index")?,
        script_text: row.try_get("script")?,
        visual_prompt: row
            .try_get::<Option<String>, _>("visual_prompt")?
            .or_else(|| row.try_get("prompt").ok()),
        motion_prompt: row.try_get("motion_prompt")?,
        metadata_json,
        created_at: parse_time(row.try_get("created_at")?)?,
    })
}

fn row_to_stage(row: sqlx::sqlite::SqliteRow) -> AppResult<PipelineStage> {
    Ok(PipelineStage {
        id: row.try_get("id")?,
        run_id: row.try_get("run_id")?,
        stage_type: parse_stage_type(row.try_get::<String, _>("stage_type")?),
        status: parse_stage_status(row.try_get::<String, _>("status")?),
        error: row.try_get("error")?,
        order_index: row.try_get("order_index").ok(),
        started_at: parse_optional_time(row.try_get("started_at")?)?,
        finished_at: parse_optional_time(row.try_get("finished_at")?)?,
    })
}

fn row_to_run(row: sqlx::sqlite::SqliteRow) -> AppResult<PipelineRun> {
    Ok(PipelineRun {
        id: row.try_get("id")?,
        task_id: row.try_get("task_id")?,
        status: parse_run_status(row.try_get::<String, _>("status")?),
        current_stage: parse_stage_option(row.try_get::<Option<String>, _>("current_stage")?),
        error: row.try_get("error")?,
        started_at: parse_optional_time(row.try_get("started_at")?)?,
        finished_at: parse_optional_time(row.try_get("finished_at")?)?,
        created_at: parse_optional_time(row.try_get("created_at")?)?,
    })
}

fn row_to_run_list_item(row: sqlx::sqlite::SqliteRow) -> AppResult<RunListItem> {
    let title: String = row.try_get("task_title")?;
    let run = row_to_run(row)?;
    Ok(RunListItem {
        id: run.id,
        task_id: run.task_id,
        title,
        status: display_run_status(&run.status),
        current_stage: run.current_stage.as_ref().map(display_stage_type),
        created_at: run
            .created_at
            .or(run.started_at)
            .map(|value| value.to_rfc3339())
            .unwrap_or_default(),
    })
}

fn row_to_log(row: sqlx::sqlite::SqliteRow) -> AppResult<AppLog> {
    let context: Option<String> = row.try_get("context_json")?;
    Ok(AppLog {
        id: row.try_get("id")?,
        task_id: row.try_get("task_id")?,
        run_id: row.try_get("run_id")?,
        level: row.try_get("level")?,
        message: row.try_get("message")?,
        context_json: parse_context(context)?,
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
        StageType::ScriptPlanning => "script_planning",
        StageType::StoryboardGeneration => "storyboard_generation",
        StageType::TtsSynthesis => "tts_synthesis",
        StageType::SegmentGeneration => "segment_generation",
        StageType::FinalRender => "final_render",
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

fn parse_run_status(value: String) -> RunStatus {
    match value.as_str() {
        "completed" => RunStatus::Completed,
        "failed" => RunStatus::Failed,
        "canceled" => RunStatus::Canceled,
        _ => RunStatus::Running,
    }
}

fn parse_stage_option(value: Option<String>) -> Option<StageType> {
    value.map(parse_stage_type)
}

fn parse_stage_type(value: String) -> StageType {
    match value.as_str() {
        "script_rewrite" => StageType::ScriptRewrite,
        "script_planning" => StageType::ScriptPlanning,
        "storyboard_generation" => StageType::StoryboardGeneration,
        "tts_synthesis" => StageType::TtsSynthesis,
        "segment_generation" => StageType::SegmentGeneration,
        "final_render" => StageType::FinalRender,
        _ => StageType::TranscriptExtraction,
    }
}

fn parse_stage_status(value: String) -> StageStatus {
    match value.as_str() {
        "pending" => StageStatus::Pending,
        "completed" => StageStatus::Completed,
        "failed" => StageStatus::Failed,
        "canceled" => StageStatus::Canceled,
        _ => StageStatus::Running,
    }
}

fn parse_asset_type(value: String) -> AssetType {
    match value.as_str() {
        "source_image" => AssetType::SourceImage,
        "audio" => AssetType::Audio,
        "tts_segment" => AssetType::TtsSegment,
        "keyframe" => AssetType::Keyframe,
        "generated_frame" => AssetType::GeneratedFrame,
        "video_segment" => AssetType::VideoSegment,
        "subtitle" => AssetType::Subtitle,
        "final_video" => AssetType::FinalVideo,
        _ => AssetType::SourceVideo,
    }
}

fn asset_status_text(status: &AssetStatus) -> &'static str {
    match status {
        AssetStatus::Pending => "pending",
        AssetStatus::Generating => "generating",
        AssetStatus::Ready => "ready",
        AssetStatus::Failed => "failed",
    }
}

fn parse_asset_status(value: String) -> AssetStatus {
    match value.as_str() {
        "pending" => AssetStatus::Pending,
        "generating" => AssetStatus::Generating,
        "failed" => AssetStatus::Failed,
        _ => AssetStatus::Ready,
    }
}

fn display_run_status(status: &RunStatus) -> String {
    match status {
        RunStatus::Running => "RUNNING",
        RunStatus::Completed => "COMPLETED",
        RunStatus::Failed => "FAILED",
        RunStatus::Canceled => "CANCELLED",
    }
    .to_string()
}

fn display_task_status(status: &TaskStatus) -> String {
    match status {
        TaskStatus::Running => "RUNNING",
        TaskStatus::Completed => "COMPLETED",
        TaskStatus::Failed => "FAILED",
        TaskStatus::Canceled => "CANCELLED",
        TaskStatus::Draft => "PENDING",
    }
    .to_string()
}

fn display_stage_status(status: &StageStatus) -> String {
    match status {
        StageStatus::Pending => "PENDING",
        StageStatus::Running => "RUNNING",
        StageStatus::Completed => "COMPLETED",
        StageStatus::Failed => "FAILED",
        StageStatus::Canceled => "CANCELLED",
    }
    .to_string()
}

fn display_stage_type(stage: &StageType) -> String {
    display_stage_type_str(&stage_type_text(stage).to_string())
}

fn display_stage_type_str(value: &str) -> String {
    value.to_uppercase()
}

fn asset_type_text(asset_type: &AssetType) -> &'static str {
    match asset_type {
        AssetType::SourceVideo => "source_video",
        AssetType::SourceImage => "source_image",
        AssetType::Audio => "audio",
        AssetType::TtsSegment => "tts_segment",
        AssetType::Keyframe => "keyframe",
        AssetType::GeneratedFrame => "generated_frame",
        AssetType::VideoSegment => "video_segment",
        AssetType::Subtitle => "subtitle",
        AssetType::FinalVideo => "final_video",
    }
}

fn task_type_text(task_type: &WorkflowTaskType) -> &'static str {
    match task_type {
        WorkflowTaskType::Replicate => "replicate",
        WorkflowTaskType::ImageToVideo => "image_to_video",
    }
}

fn parse_task_type(value: &str) -> WorkflowTaskType {
    match value {
        "image_to_video" => WorkflowTaskType::ImageToVideo,
        _ => WorkflowTaskType::Replicate,
    }
}

pub fn workflow_task_type_from_config(config: &Value) -> WorkflowTaskType {
    config
        .get("taskType")
        .and_then(Value::as_str)
        .map(parse_task_type)
        .unwrap_or(WorkflowTaskType::Replicate)
}

fn parse_time(value: String) -> AppResult<chrono::DateTime<Utc>> {
    let parsed = chrono::DateTime::parse_from_rfc3339(&value)
        .map_err(|error| crate::errors::AppError::Database(sqlx::Error::Decode(Box::new(error))))?;
    Ok(parsed.with_timezone(&Utc))
}

fn parse_optional_time(value: Option<String>) -> AppResult<Option<chrono::DateTime<Utc>>> {
    value.map(parse_time).transpose()
}

fn parse_context(value: Option<String>) -> AppResult<Option<Value>> {
    value
        .map(|raw| serde_json::from_str::<Value>(&raw))
        .transpose()
        .map_err(Into::into)
}

fn empty_cost_summary() -> CostSummary {
    CostSummary {
        total_cost_usd: 0.0,
        incomplete: false,
        providers: Vec::new(),
    }
}

fn summarize_usage_rows(rows: &[sqlx::sqlite::SqliteRow]) -> CostSummary {
    let mut groups: HashMap<String, ProviderCostSummary> = HashMap::new();
    for row in rows {
        let provider: String = row.try_get("provider").unwrap_or_default();
        let unit: String = row.try_get("unit").unwrap_or_else(|_| "mixed".into());
        let quantity: f64 = row.try_get("quantity").unwrap_or(0.0);
        let cost_usd: Option<f64> = row.try_get("cost_usd").ok();
        let success: i64 = row.try_get("success").unwrap_or(1);
        let success = success != 0;
        let entry = groups
            .entry(provider.clone())
            .or_insert_with(|| ProviderCostSummary {
                provider,
                calls: 0,
                failed_calls: 0,
                quantity: 0.0,
                unit: unit.clone(),
                cost_usd: 0.0,
                unknown_cost_count: 0,
            });
        entry.calls += 1;
        if success {
            entry.quantity = round_cost(entry.quantity + quantity);
            if let Some(cost) = cost_usd {
                entry.cost_usd = round_cost(entry.cost_usd + cost);
            } else {
                entry.unknown_cost_count += 1;
            }
        } else {
            entry.failed_calls += 1;
        }
        if entry.unit != unit {
            entry.unit = "mixed".to_string();
        }
    }
    let mut providers: Vec<ProviderCostSummary> = groups.into_values().collect();
    providers.sort_by(|left, right| left.provider.cmp(&right.provider));
    let total_cost_usd = round_cost(providers.iter().map(|row| row.cost_usd).sum());
    let incomplete = providers.iter().any(|row| row.unknown_cost_count > 0);
    CostSummary {
        total_cost_usd,
        incomplete,
        providers,
    }
}

fn round_cost(value: f64) -> f64 {
    (value * 10000.0).round() / 10000.0
}

fn default_provider_base_url(provider: &str) -> &'static str {
    match provider.to_uppercase().as_str() {
        "DEEPSEEK" => "https://api.deepseek.com",
        "QWEN_VL" => "https://dashscope.aliyuncs.com/api/v1",
        "TONGYI" => "https://dashscope.aliyuncs.com/api/v1",
        "COSYVOICE" => "https://dashscope.aliyuncs.com/api/v1",
        "SEEDANCE" => "https://ark.cn-beijing.volces.com/api/v3",
        _ => "https://api.example.com",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::CreateTaskInput;

    async fn test_repo() -> (Repository, Workspace) {
        let root = std::env::temp_dir().join(format!("repix-db-test-{}", Uuid::new_v4()));
        tokio::fs::create_dir_all(&root).await.unwrap();
        let workspace = Workspace::from_root(root);
        let repo = Repository::initialize(&workspace).await.unwrap();
        (repo, workspace)
    }

    async fn running_task(repo: &Repository) -> String {
        let task = repo
            .create_task(CreateTaskInput {
                title: "test task".into(),
                source_path: "source.mp4".into(),
                config_json: serde_json::json!({}),
            })
            .await
            .unwrap();
        repo.update_task_status(&task.id, TaskStatus::Running)
            .await
            .unwrap();
        task.id
    }

    #[tokio::test]
    async fn startup_failure_keeps_run_and_task_consistent() {
        let (repo, _workspace) = test_repo().await;
        let task = repo
            .create_task(CreateTaskInput {
                title: "startup failure".into(),
                source_path: "missing.mp4".into(),
                config_json: serde_json::json!({}),
            })
            .await
            .unwrap();

        let run = repo.create_run(&task.id).await.unwrap();
        let running_task = repo.get_task(&task.id).await.unwrap().unwrap();
        assert!(matches!(running_task.status, TaskStatus::Running));

        repo.fail_run_startup(&run.id, &task.id, "source file missing")
            .await
            .unwrap();

        let failed_run = repo.latest_run(&task.id).await.unwrap().unwrap();
        assert!(matches!(failed_run.status, RunStatus::Failed));
        assert_eq!(failed_run.error.as_deref(), Some("source file missing"));
        let failed_task = repo.get_task(&task.id).await.unwrap().unwrap();
        assert!(matches!(failed_task.status, TaskStatus::Failed));
        let logs = repo.list_run_logs(&run.id, 10).await.unwrap();
        assert!(logs.iter().any(|log| log.message == "source file missing"));
    }

    #[tokio::test]
    async fn create_run_rejects_duplicate_active_run() {
        let (repo, _workspace) = test_repo().await;
        let task_id = running_task(&repo).await;

        repo.create_run(&task_id).await.unwrap();
        let second = repo.create_run(&task_id).await;

        assert!(second.is_err(), "second concurrent run must be rejected");
    }

    #[tokio::test]
    async fn create_run_allows_restart_after_terminal_run() {
        let (repo, _workspace) = test_repo().await;
        let task_id = running_task(&repo).await;

        let first = repo.create_run(&task_id).await.unwrap();
        repo.cancel_active_run(&first.id, &task_id).await.unwrap();

        repo.create_run(&task_id)
            .await
            .expect("restart after terminal run must be allowed");
    }

    #[tokio::test]
    async fn canceled_run_cannot_complete_its_stage() {
        let (repo, _workspace) = test_repo().await;
        let task_id = running_task(&repo).await;
        let run = repo.create_run(&task_id).await.unwrap();
        assert!(repo
            .start_stage(&run.id, StageType::SegmentGeneration, 0)
            .await
            .unwrap());

        assert!(repo.cancel_active_run(&run.id, &task_id).await.unwrap());
        assert!(!repo
            .complete_stage(&run.id, StageType::SegmentGeneration)
            .await
            .unwrap());

        let stored_run = repo.get_run(&run.id).await.unwrap().unwrap();
        assert_eq!(stored_run.status, "CANCELLED");
        let stages = repo.list_run_stages(&run.id).await.unwrap();
        assert!(matches!(stages[0].status, StageStatus::Canceled));
        let task = repo.get_task(&task_id).await.unwrap().unwrap();
        assert!(matches!(task.status, TaskStatus::Canceled));
    }

    #[tokio::test]
    async fn cancel_and_complete_choose_one_consistent_terminal_state() {
        let (repo, _workspace) = test_repo().await;
        let repo = std::sync::Arc::new(repo);
        let task_id = running_task(&repo).await;
        let run = repo.create_run(&task_id).await.unwrap();
        let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(3));

        let cancel = tokio::spawn({
            let repo = repo.clone();
            let barrier = barrier.clone();
            let task_id = task_id.clone();
            let run_id = run.id.clone();
            async move {
                barrier.wait().await;
                repo.cancel_active_run(&run_id, &task_id).await.unwrap()
            }
        });
        let complete = tokio::spawn({
            let repo = repo.clone();
            let barrier = barrier.clone();
            let task_id = task_id.clone();
            let run_id = run.id.clone();
            async move {
                barrier.wait().await;
                repo.complete_run_if_active(&run_id, &task_id)
                    .await
                    .unwrap()
            }
        });
        barrier.wait().await;

        let cancel_applied = cancel.await.unwrap();
        let complete_applied = complete.await.unwrap();
        assert_ne!(cancel_applied, complete_applied);
        assert_run_and_task_terminal_state_matches(&repo, &task_id, &run.id).await;
    }

    #[tokio::test]
    async fn cancel_and_failure_choose_one_consistent_terminal_state() {
        let (repo, _workspace) = test_repo().await;
        let repo = std::sync::Arc::new(repo);
        let task_id = running_task(&repo).await;
        let run = repo.create_run(&task_id).await.unwrap();
        let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(3));

        let cancel = tokio::spawn({
            let repo = repo.clone();
            let barrier = barrier.clone();
            let task_id = task_id.clone();
            let run_id = run.id.clone();
            async move {
                barrier.wait().await;
                repo.cancel_active_run(&run_id, &task_id).await.unwrap()
            }
        });
        let fail = tokio::spawn({
            let repo = repo.clone();
            let barrier = barrier.clone();
            let task_id = task_id.clone();
            let run_id = run.id.clone();
            async move {
                barrier.wait().await;
                repo.fail_run_if_active(&run_id, &task_id, StageType::SegmentGeneration, "boom")
                    .await
                    .unwrap()
            }
        });
        barrier.wait().await;

        let cancel_applied = cancel.await.unwrap();
        let fail_applied = fail.await.unwrap();
        assert_ne!(cancel_applied, fail_applied);
        assert_run_and_task_terminal_state_matches(&repo, &task_id, &run.id).await;
    }

    #[tokio::test]
    async fn terminal_old_run_cannot_overwrite_restarted_task() {
        let (repo, _workspace) = test_repo().await;
        let task_id = running_task(&repo).await;
        let old_run = repo.create_run(&task_id).await.unwrap();
        assert!(repo.cancel_active_run(&old_run.id, &task_id).await.unwrap());
        let new_run = repo.create_run(&task_id).await.unwrap();

        assert!(!repo
            .fail_run_if_active(
                &old_run.id,
                &task_id,
                StageType::SegmentGeneration,
                "late failure",
            )
            .await
            .unwrap());
        assert!(!repo
            .complete_run_if_active(&old_run.id, &task_id)
            .await
            .unwrap());

        let old = repo.get_run(&old_run.id).await.unwrap().unwrap();
        assert_eq!(old.status, "CANCELLED");
        let new = repo.get_run(&new_run.id).await.unwrap().unwrap();
        assert_eq!(new.status, "RUNNING");
        let task = repo.get_task(&task_id).await.unwrap().unwrap();
        assert!(matches!(task.status, TaskStatus::Running));
    }

    #[tokio::test]
    async fn initialize_fails_stale_running_runs() {
        let (repo, workspace) = test_repo().await;
        let task_id = running_task(&repo).await;
        let run = repo.create_run(&task_id).await.unwrap();

        let reopened = Repository::initialize(&workspace).await.unwrap();

        let stale_run = reopened.latest_run(&task_id).await.unwrap().unwrap();
        assert!(matches!(stale_run.status, RunStatus::Failed));
        assert_eq!(stale_run.id, run.id);
        let task = reopened.get_task(&task_id).await.unwrap().unwrap();
        assert!(matches!(task.status, TaskStatus::Failed));
    }

    async fn assert_run_and_task_terminal_state_matches(
        repo: &Repository,
        task_id: &str,
        run_id: &str,
    ) {
        let run = repo.get_run(run_id).await.unwrap().unwrap();
        let task = repo.get_task(task_id).await.unwrap().unwrap();
        match run.status.as_str() {
            "COMPLETED" => assert!(matches!(task.status, TaskStatus::Completed)),
            "FAILED" => assert!(matches!(task.status, TaskStatus::Failed)),
            "CANCELLED" => assert!(matches!(task.status, TaskStatus::Canceled)),
            status => panic!("unexpected terminal run status: {status}"),
        }
    }
}
