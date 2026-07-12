use chrono::Utc;
use tauri::{AppHandle, State};

use crate::config::{save, AppConfig};
use crate::errors::{command_error, AppError, AppResult};
use crate::media::whisper_models;
use crate::models::{
    AppLog, Asset, CostSummary, CreateTaskInput, DashboardData, DashboardSummary,
    DashscopeCredentialInput, DashscopeCredentialView, DeepSeekBalance, PickedImageFile,
    PickedVideoFile, PipelineRun, PipelineStage, ProviderBalance, ProviderBalanceAccount,
    ProviderBalanceStatus, ProviderCredentialInput, ProviderCredentialView,
    ProviderListingCredentials, ProviderModelOption, RunDetail, RunListItem, SubmitTaskResponse,
    Task, ToolCheck, WhisperModelStatus,
};
use crate::providers::{
    deepseek::DeepSeekClient, model_catalog, validate_provider_config, ProviderConfig,
};
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
pub async fn get_deepseek_balance(state: State<'_, AppState>) -> Result<DeepSeekBalance, String> {
    DeepSeekClient::new(state.repo.clone())
        .get_balance()
        .await
        .map_err(command_error)
}

#[tauri::command]
pub async fn get_provider_balances(
    state: State<'_, AppState>,
) -> Result<Vec<ProviderBalance>, String> {
    let provider_credentials = state
        .repo
        .list_provider_credentials()
        .await
        .map_err(command_error)?;
    let dashscope = state
        .repo
        .list_dashscope_credentials()
        .await
        .map_err(command_error)?;
    let mut balances = Vec::new();
    balances.push(deepseek_provider_balance(&state, &provider_credentials).await);
    balances.push(dashscope_provider_balance(&dashscope));
    balances.push(seedance_provider_balance(&provider_credentials));
    Ok(balances)
}

async fn deepseek_provider_balance(
    state: &AppState,
    credentials: &[ProviderCredentialView],
) -> ProviderBalance {
    let provider = "DEEPSEEK";
    let checked_at = Utc::now().to_rfc3339();
    if let Some(balance) = credential_issue_balance(provider, credentials, &checked_at) {
        return balance;
    }
    match DeepSeekClient::new(state.repo.clone()).get_balance().await {
        Ok(balance) => ProviderBalance {
            provider: provider.to_string(),
            status: if balance.is_available {
                ProviderBalanceStatus::Available
            } else {
                ProviderBalanceStatus::Error
            },
            checked_at: balance.checked_at,
            accounts: balance
                .balance_infos
                .into_iter()
                .map(deepseek_account)
                .collect(),
            message: if balance.is_available {
                None
            } else {
                Some("DeepSeek account is unavailable".to_string())
            },
        },
        Err(error) => error_balance(provider, &checked_at, error.to_string()),
    }
}

fn dashscope_provider_balance(credential: &DashscopeCredentialView) -> ProviderBalance {
    let checked_at = Utc::now().to_rfc3339();
    if credential.key_decrypt_failed {
        return error_balance(
            "DASHSCOPE",
            &checked_at,
            "DashScope API key cannot be decrypted".to_string(),
        );
    }
    if credential.masked_key.trim().is_empty() {
        return not_configured_balance("DASHSCOPE", &checked_at);
    }
    if credential.keys_mismatch {
        return error_balance(
            "DASHSCOPE",
            &checked_at,
            "DashScope saved keys differ across services".to_string(),
        );
    }
    unsupported_balance(
        "DASHSCOPE",
        &checked_at,
        "DashScope model API key cannot query account balance".to_string(),
    )
}

fn seedance_provider_balance(credentials: &[ProviderCredentialView]) -> ProviderBalance {
    let provider = "SEEDANCE";
    let checked_at = Utc::now().to_rfc3339();
    if let Some(balance) = credential_issue_balance(provider, credentials, &checked_at) {
        return balance;
    }
    unsupported_balance(
        provider,
        &checked_at,
        "Seedance Ark API key cannot query account balance".to_string(),
    )
}

fn credential_issue_balance(
    provider: &str,
    credentials: &[ProviderCredentialView],
    checked_at: &str,
) -> Option<ProviderBalance> {
    let credential = credentials
        .iter()
        .find(|entry| entry.provider == provider)?;
    if credential.key_decrypt_failed {
        return Some(error_balance(
            provider,
            checked_at,
            format!("{provider} API key cannot be decrypted"),
        ));
    }
    if credential.masked_key.trim().is_empty() {
        return Some(not_configured_balance(provider, checked_at));
    }
    None
}

fn deepseek_account(info: crate::models::DeepSeekBalanceInfo) -> ProviderBalanceAccount {
    ProviderBalanceAccount {
        currency: info.currency,
        total_balance: info.total_balance,
        granted_balance: Some(info.granted_balance),
        topped_up_balance: Some(info.topped_up_balance),
    }
}

fn not_configured_balance(provider: &str, checked_at: &str) -> ProviderBalance {
    ProviderBalance {
        provider: provider.to_string(),
        status: ProviderBalanceStatus::NotConfigured,
        checked_at: checked_at.to_string(),
        accounts: Vec::new(),
        message: Some(format!("{provider} API key is not configured")),
    }
}

fn unsupported_balance(provider: &str, checked_at: &str, message: String) -> ProviderBalance {
    ProviderBalance {
        provider: provider.to_string(),
        status: ProviderBalanceStatus::Unsupported,
        checked_at: checked_at.to_string(),
        accounts: Vec::new(),
        message: Some(message),
    }
}

fn error_balance(provider: &str, checked_at: &str, message: String) -> ProviderBalance {
    ProviderBalance {
        provider: provider.to_string(),
        status: ProviderBalanceStatus::Error,
        checked_at: checked_at.to_string(),
        accounts: Vec::new(),
        message: Some(message),
    }
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
pub async fn get_run(
    run_id: String,
    state: State<'_, AppState>,
) -> Result<Option<RunDetail>, String> {
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
            config
                .asr_model
                .clone()
                .unwrap_or_else(|| "base".to_string()),
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
    let status = whisper_models::model_status(&state.workspace, model_dir.as_deref(), model_name);
    let download = whisper_models::get_download_state().await;
    Ok(merge_whisper_download_state(status, &download))
}

fn merge_whisper_download_state(
    mut status: WhisperModelStatus,
    download: &whisper_models::DownloadState,
) -> WhisperModelStatus {
    if status.model_name != download.model_name {
        return status;
    }
    status.downloading = download.downloading;
    status.bytes_done = download.bytes_done;
    status.bytes_total = download.bytes_total;
    status.error.clone_from(&download.error);
    status
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
    Ok(state.config.read().await.clone())
}

#[tauri::command]
pub async fn update_settings(
    input: AppConfig,
    state: State<'_, AppState>,
) -> Result<AppConfig, String> {
    let persisted = save(&state.workspace, &input)
        .await
        .map_err(command_error)?;
    {
        let mut config = state.config.write().await;
        *config = persisted;
    }
    Ok(state.config.read().await.clone())
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
    credentials: Option<ProviderListingCredentials>,
    state: State<'_, AppState>,
) -> Result<Vec<ProviderModelOption>, String> {
    let mock = state.config.read().await.mock_providers;
    if mock {
        return Ok(model_catalog::mock_models(&provider));
    }
    let creds = match credentials {
        Some(credentials) => {
            normalize_listing_credentials(&provider, credentials).map_err(command_error)?
        }
        None => state
            .repo
            .get_provider_listing_credentials(&provider)
            .await
            .map_err(command_error)?,
    };
    model_catalog::fetch_models(&provider, &creds)
        .await
        .map_err(command_error)
}

fn normalize_listing_credentials(
    provider: &str,
    credentials: ProviderListingCredentials,
) -> AppResult<ProviderListingCredentials> {
    let api_key = credentials.api_key.trim().to_string();
    if api_key.is_empty() {
        return Err(AppError::Provider(format!(
            "{provider} API key not configured."
        )));
    }
    let base_url = if credentials.base_url.trim().is_empty() {
        crate::db::default_provider_base_url(provider).to_string()
    } else {
        credentials.base_url.trim().to_string()
    };
    Ok(ProviderListingCredentials { api_key, base_url })
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dashscope_balance_reports_not_configured_without_key() {
        let balance = dashscope_provider_balance(&DashscopeCredentialView {
            masked_key: String::new(),
            key_decrypt_failed: false,
            keys_mismatch: false,
            base_url: None,
            qwen_vl_model: None,
            tongyi_model: None,
            cosyvoice_model: None,
        });
        assert!(matches!(
            balance.status,
            ProviderBalanceStatus::NotConfigured
        ));
    }

    #[test]
    fn seedance_balance_reports_unsupported_when_key_exists() {
        let credentials = vec![ProviderCredentialView {
            provider: "SEEDANCE".to_string(),
            masked_key: "sk-****".to_string(),
            key_decrypt_failed: false,
            config: None,
        }];
        let balance = seedance_provider_balance(&credentials);
        assert!(matches!(balance.status, ProviderBalanceStatus::Unsupported));
    }

    #[test]
    fn listing_credentials_use_provider_default_without_persisting_a_model() {
        let credentials = normalize_listing_credentials(
            "DEEPSEEK",
            ProviderListingCredentials {
                api_key: "  temporary-key  ".to_string(),
                base_url: "  ".to_string(),
            },
        )
        .unwrap();

        assert_eq!(credentials.api_key, "temporary-key");
        assert_eq!(credentials.base_url, "https://api.deepseek.com");
    }

    #[test]
    fn listing_credentials_reject_empty_temporary_key() {
        let error = normalize_listing_credentials(
            "DEEPSEEK",
            ProviderListingCredentials {
                api_key: "  ".to_string(),
                base_url: "https://api.deepseek.com".to_string(),
            },
        )
        .unwrap_err();

        assert!(error.to_string().contains("API key not configured"));
    }

    #[test]
    fn whisper_status_merges_download_state_for_matching_model() {
        let status = whisper_status("base");
        let download = whisper_models::DownloadState {
            downloading: true,
            model_name: "base".into(),
            bytes_done: 128,
            bytes_total: Some(256),
            error: Some("interrupted".into()),
        };

        let merged = merge_whisper_download_state(status, &download);

        assert!(merged.downloading);
        assert_eq!(merged.bytes_done, 128);
        assert_eq!(merged.bytes_total, Some(256));
        assert_eq!(merged.error.as_deref(), Some("interrupted"));
    }

    #[test]
    fn whisper_status_ignores_download_state_for_other_model() {
        let status = whisper_status("small");
        let download = whisper_models::DownloadState {
            downloading: true,
            model_name: "base".into(),
            bytes_done: 128,
            bytes_total: Some(256),
            error: Some("interrupted".into()),
        };

        let merged = merge_whisper_download_state(status, &download);

        assert!(!merged.downloading);
        assert_eq!(merged.bytes_done, 0);
        assert_eq!(merged.bytes_total, None);
        assert_eq!(merged.error, None);
    }

    fn whisper_status(model_name: &str) -> WhisperModelStatus {
        WhisperModelStatus {
            model_name: model_name.into(),
            downloaded: false,
            path: format!("{model_name}.bin"),
            downloading: false,
            bytes_done: 0,
            bytes_total: None,
            error: None,
        }
    }
}
