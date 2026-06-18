use tauri::{AppHandle, State};

use crate::config::{save, AppConfig};
use crate::errors::command_error;
use crate::media::whisper_models;
use crate::models::{
    AppLog, Asset, CostSummary, CreateTaskInput, DashboardData, DashboardSummary, PickedImageFile,
    PickedVideoFile,
    DashscopeCredentialInput, DashscopeCredentialView, PipelineRun, PipelineStage,
    ProviderCredentialInput, ProviderCredentialView, ProviderModelOption, RunDetail, RunListItem,
    SubmitTaskResponse, Task, ToolCheck, WhisperModelStatus,
};
use crate::providers::{model_catalog, validate_provider_config, ProviderConfig};
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
pub async fn reveal_asset(path: String) -> Result<(), String> {
    let path = std::path::PathBuf::from(path);
    if !path.exists() {
        return Err(command_error(crate::errors::AppError::Workflow(format!(
            "file not found: {}",
            path.display()
        ))));
    }
    std::process::Command::new("explorer")
        .arg(format!("/select,{}", path.display()))
        .spawn()
        .map_err(|error| command_error(crate::errors::AppError::Workflow(error.to_string())))?;
    Ok(())
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
    let (model_name, model_dir) = {
        let config = state.config.read().await;
        (
            config.asr_model.clone().unwrap_or_else(|| "base".to_string()),
            config.whisper_model_dir.clone(),
        )
    };

    let mut tools = state.ffmpeg.check_tools().await;
    if resolve_whisper_cli_available(&state).await {
        if let Err(error) = whisper_models::ensure_whisper_model(
            &state.workspace,
            model_dir.as_deref(),
            &model_name,
        )
        .await
        {
            tracing::warn!("whisper model ensure failed during tool check: {error}");
        }
    }
    tools.push(state.whisper.check_tool(&state.workspace).await);
    Ok(tools)
}

#[tauri::command]
pub async fn ensure_whisper_model(
    model: Option<String>,
    state: State<'_, AppState>,
) -> Result<WhisperModelStatus, String> {
    let (model_name, model_dir) = {
        let config = state.config.read().await;
        (
            model
                .filter(|value| !value.trim().is_empty())
                .or_else(|| config.asr_model.clone())
                .unwrap_or_else(|| "base".to_string()),
            config.whisper_model_dir.clone(),
        )
    };
    whisper_models::ensure_whisper_model(&state.workspace, model_dir.as_deref(), &model_name)
        .await
        .map_err(command_error)?;
    whisper_model_status_internal(&state, &model_name).await
}

#[tauri::command]
pub async fn get_whisper_model_status(
    model: Option<String>,
    state: State<'_, AppState>,
) -> Result<WhisperModelStatus, String> {
    let model_name = {
        let config = state.config.read().await;
        model
            .filter(|value| !value.trim().is_empty())
            .or_else(|| config.asr_model.clone())
            .unwrap_or_else(|| "base".to_string())
    };
    whisper_model_status_internal(&state, &model_name).await
}

async fn whisper_model_status_internal(
    state: &AppState,
    model_name: &str,
) -> Result<WhisperModelStatus, String> {
    let model_dir = state.config.read().await.whisper_model_dir.clone();
    let mut status = whisper_models::model_status(
        &state.workspace,
        model_dir.as_deref(),
        model_name,
    );
    let download = whisper_models::get_download_state().await;
    status.downloading = download.downloading && download.model_name == model_name;
    status.bytes_done = download.bytes_done;
    status.bytes_total = download.bytes_total;
    status.error = download.error;
    Ok(status)
}

async fn resolve_whisper_cli_available(state: &AppState) -> bool {
    let config = state.config.read().await;
    crate::media::bundled_tools::resolve_tool_path(
        config.whisper_bin.as_deref(),
        "whisper-cli",
        "whisper-cli",
    )
    .is_some_and(|path| path.exists() && crate::media::bundled_tools::is_executable_file(&path))
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
    let secret_empty = input
        .s3_secret_key
        .as_deref()
        .map(str::trim)
        .is_none_or(str::is_empty);
    if secret_empty {
        let from_memory = state.config.read().await.s3_secret_key_encrypted.clone();
        input.s3_secret_key_encrypted = if from_memory.is_some() {
            from_memory
        } else {
            crate::config::load_or_create(&state.workspace)
                .await
                .ok()
                .and_then(|config| config.s3_secret_key_encrypted)
        };
    }
    let persisted = save(&state.workspace, &input)
        .await
        .map_err(command_error)?;
    {
        let mut config = state.config.write().await;
        *config = persisted;
    }
    Ok(crate::storage::oss::sanitize_config_for_ui(
        state.config.read().await.clone(),
    ))
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
pub async fn list_dashscope_credentials(
    state: State<'_, AppState>,
) -> Result<DashscopeCredentialView, String> {
    state
        .repo
        .list_dashscope_credentials()
        .await
        .map_err(command_error)
}

#[tauri::command]
pub async fn save_dashscope_credential(
    input: DashscopeCredentialInput,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .repo
        .save_dashscope_credential(input)
        .await
        .map_err(command_error)
}

#[tauri::command]
pub async fn list_provider_models(
    provider: String,
    state: State<'_, AppState>,
) -> Result<Vec<ProviderModelOption>, String> {
    let mock = state.config.read().await.mock_providers;
    if mock {
        return Ok(model_catalog::mock_models(&provider));
    }
    let creds = state
        .repo
        .get_provider_listing_credentials(&provider)
        .await
        .map_err(command_error)?;
    model_catalog::fetch_models(&provider, &creds)
        .await
        .map_err(command_error)
}

#[tauri::command]
pub async fn test_provider(config: ProviderConfig) -> Result<(), String> {
    validate_provider_config(&config).map_err(command_error)
}

#[tauri::command]
pub async fn pick_image_files() -> Result<Vec<PickedImageFile>, String> {
    let picked = rfd::AsyncFileDialog::new()
        .add_filter("Image", &["png", "jpg", "jpeg", "webp"])
        .pick_files()
        .await;
    let Some(files) = picked else {
        return Ok(Vec::new());
    };
    let mut results = Vec::with_capacity(files.len());
    for file in files {
        let path = file.path().to_path_buf();
        let metadata = tokio::fs::metadata(&path)
            .await
            .map_err(|error| command_error(crate::errors::AppError::Filesystem(error)))?;
        results.push(PickedImageFile {
            path: path.to_string_lossy().to_string(),
            name: file.file_name(),
            size_bytes: metadata.len(),
        });
    }
    Ok(results)
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