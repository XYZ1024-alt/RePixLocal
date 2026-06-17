use tauri::State;

use crate::config::{save, AppConfig};
use crate::errors::command_error;
use crate::models::{
    AppLog, Asset, CreateTaskInput, DashboardSummary, PipelineRun, PipelineStage,
    ProviderCredentialInput, Task, ToolCheck,
};
use crate::providers::{validate_provider_config, ProviderConfig};
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
pub async fn start_task(
    task_id: String,
    state: State<'_, AppState>,
) -> Result<PipelineRun, String> {
    state.workflow.start(&task_id).await.map_err(command_error)
}

#[tauri::command]
pub async fn cancel_task(task_id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.workflow.cancel(&task_id).await.map_err(command_error)
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
    Ok(state.ffmpeg.check_tools())
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<AppConfig, String> {
    Ok(state.config.read().await.clone())
}

#[tauri::command]
pub async fn update_settings(
    input: AppConfig,
    state: State<'_, AppState>,
) -> Result<AppConfig, String> {
    save(&state.workspace, &input)
        .await
        .map_err(command_error)?;
    *state.config.write().await = input.clone();
    Ok(input)
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
pub async fn test_provider(config: ProviderConfig) -> Result<(), String> {
    validate_provider_config(&config).map_err(command_error)
}
