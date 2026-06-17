use tauri::{AppHandle, State};

use crate::config::{save, AppConfig};
use crate::errors::command_error;
use crate::models::{
    AppLog, Asset, CostSummary, CreateTaskInput, DashboardData, DashboardSummary, PickedVideoFile,
    PipelineRun, PipelineStage, ProviderCredentialInput, ProviderCredentialView,
    ProviderModelOption, RunDetail, RunListItem, SubmitTaskResponse, Task, ToolCheck,
};
use crate::providers::{catalog, validate_provider_config, ProviderConfig};
use crate::state::AppState;

#[tauri::command]
pub async fn create_task(
    input: CreateTaskInput,
    state: State<'_, AppState>,
) -> Result<Task, String> {
    state.repo.create_task(input).await.map_err(command_error)
}

#[tauri::command]
pub async fn list_tasks(state: State<'_, AppState>) -> Result<Vec<Task>, String> {
    state.repo.list_tasks().await.map_err(command_error)
}

#[tauri::command]
pub async fn get_dashboard_summary(state: State<'_, AppState>) -> Result<DashboardSummary, String> {
    state.repo.dashboard_summary().await.map_err(command_error)
}

#[tauri::command]
pub async fn get_dashboard_data(state: State<'_, AppState>) -> Result<DashboardData, String> {
    state.repo.dashboard_data().await.map_err(command_error)
}

#[tauri::command]
pub async fn get_task(task_id: String, state: State<'_, AppState>) -> Result<Option<Task>, String> {
    state.repo.get_task(&task_id).await.map_err(command_error)
}

#[tauri::command]
pub async fn get_latest_run(
    task_id: String,
    state: State<'_, AppState>,
) -> Result<Option<PipelineRun>, String> {
    state.repo.latest_run(&task_id).await.map_err(command_error)
}

#[tauri::command]
pub async fn list_runs(
    limit: Option<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<RunListItem>, String> {
    state
        .repo
        .list_runs(limit.unwrap_or(100))
        .await
        .map_err(command_error)
}

#[tauri::command]
pub async fn get_run(run_id: String, state: State<'_, AppState>) -> Result<Option<RunDetail>, String> {
    state.repo.get_run(&run_id).await.map_err(command_error)
}

#[tauri::command]
pub async fn get_run_costs(
    run_id: String,
    state: State<'_, AppState>,
) -> Result<CostSummary, String> {
    state
        .repo
        .get_run_cost_summary(&run_id)
        .await
        .map_err(command_error)
}

#[tauri::command]
pub async fn start_task(
    task_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<PipelineRun, String> {
    state
        .workflow
        .start(&task_id, &app)
        .await
        .map_err(command_error)
}

#[tauri::command]
pub async fn submit_task(
    task_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SubmitTaskResponse, String> {
    let run = state
        .workflow
        .start(&task_id, &app)
        .await
        .map_err(command_error)?;
    Ok(SubmitTaskResponse { run_id: run.id })
}

#[tauri::command]
pub async fn cancel_task(
    task_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .workflow
        .cancel(&task_id, &app)
        .await
        .map_err(command_error)
}

#[tauri::command]
pub async fn list_assets(
    task_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<Asset>, String> {
    state
        .repo
        .list_assets(&task_id)
        .await
        .map_err(command_error)
}

#[tauri::command]
pub async fn list_all_assets(
    task_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<Asset>, String> {
    state
        .repo
        .list_all_assets(task_id.as_deref())
        .await
        .map_err(command_error)
}

#[tauri::command]
pub async fn list_run_stages(
    run_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<PipelineStage>, String> {
    state
        .repo
        .list_run_stages(&run_id)
        .await
        .map_err(command_error)
}

#[tauri::command]
pub async fn list_logs(task_id: String, state: State<'_, AppState>) -> Result<Vec<AppLog>, String> {
    state.repo.list_logs(&task_id).await.map_err(command_error)
}

#[tauri::command]
pub async fn check_ffmpeg(state: State<'_, AppState>) -> Result<Vec<ToolCheck>, String> {
    let mut tools = state.ffmpeg.check_tools().await;
    tools.push(state.whisper.check_tool().await);
    Ok(tools)
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<AppConfig, String> {
    Ok(crate::storage::oss::sanitize_config_for_ui(
        state.config.read().await.clone(),
    ))
}

#[tauri::command]
pub async fn update_settings(
    mut input: AppConfig,
    state: State<'_, AppState>,
) -> Result<AppConfig, String> {
    {
        let current = state.config.read().await;
        let secret_empty = input
            .s3_secret_key
            .as_deref()
            .map(str::trim)
            .is_none_or(str::is_empty);
        if secret_empty {
            input.s3_secret_key_encrypted = current.s3_secret_key_encrypted.clone();
        }
    }
    save(&state.workspace, &input)
        .await
        .map_err(command_error)?;
    {
        let mut config = state.config.write().await;
        *config = input.clone();
    }
    Ok(crate::storage::oss::sanitize_config_for_ui(input))
}

#[tauri::command]
pub async fn save_provider_credential(
    input: ProviderCredentialInput,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .repo
        .save_provider_credential(input)
        .await
        .map_err(command_error)
}

#[tauri::command]
pub async fn list_provider_credentials(
    state: State<'_, AppState>,
) -> Result<Vec<ProviderCredentialView>, String> {
    state
        .repo
        .list_provider_credentials()
        .await
        .map_err(command_error)
}

#[tauri::command]
pub async fn list_provider_models(provider: String) -> Result<Vec<ProviderModelOption>, String> {
    Ok(catalog::list_provider_models(&provider))
}

#[tauri::command]
pub async fn test_provider(config: ProviderConfig) -> Result<(), String> {
    validate_provider_config(&config).map_err(command_error)
}

#[tauri::command]
pub async fn pick_video_file() -> Result<Option<PickedVideoFile>, String> {
    let picked = rfd::AsyncFileDialog::new()
        .add_filter("Video", &["mp4", "mov"])
        .pick_file()
        .await;
    let Some(file) = picked else {
        return Ok(None);
    };
    let path = file.path().to_path_buf();
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|error| command_error(crate::errors::AppError::Filesystem(error)))?;
    Ok(Some(PickedVideoFile {
        path: path.to_string_lossy().to_string(),
        name: file.file_name(),
        size_bytes: metadata.len(),
    }))
}