pub mod commands;
pub mod config;
pub mod db;
pub mod errors;
pub mod media;
pub mod models;
pub mod providers;
pub mod secrets;
pub mod state;
pub mod storage;
pub mod workflow;
pub mod workspace;

use commands::{
    cancel_task, check_ffmpeg, create_task, ensure_whisper_model, get_dashboard_data,
    get_dashboard_summary, get_deepseek_balance, get_latest_run, get_provider_balances, get_run,
    get_run_costs, get_settings, get_task, get_whisper_model_status, list_all_assets, list_assets,
    list_dashscope_credentials, list_logs, list_provider_credentials, list_provider_models,
    list_run_stages, list_runs, list_tasks, pick_image_files, pick_video_file, reveal_asset,
    save_dashscope_credential, save_provider_credential, start_task, submit_task, test_provider,
    update_settings,
};
use state::AppState;
use tauri::Manager;

pub fn run() {
    tracing_subscriber::fmt::init();
    let state = tauri::async_runtime::block_on(initialize_state())
        .expect("failed to initialize RePix Local state");

    tauri::Builder::default()
        .manage(state)
        .setup(|app| {
            if let Err(error) = media::whisper_runtime::sync_whisper_runtime_near_exe() {
                tracing::warn!("failed to sync whisper runtime DLLs: {error}");
            }
            let app_state = app.state::<AppState>();
            app.asset_protocol_scope()
                .allow_directory(app_state.workspace.tasks_dir(), true)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_task,
            get_dashboard_summary,
            get_dashboard_data,
            get_deepseek_balance,
            get_provider_balances,
            list_tasks,
            get_task,
            get_latest_run,
            list_runs,
            get_run,
            get_run_costs,
            start_task,
            submit_task,
            cancel_task,
            list_assets,
            list_all_assets,
            reveal_asset,
            list_run_stages,
            list_logs,
            check_ffmpeg,
            ensure_whisper_model,
            get_whisper_model_status,
            get_settings,
            update_settings,
            save_provider_credential,
            save_dashscope_credential,
            list_provider_credentials,
            list_dashscope_credentials,
            list_provider_models,
            test_provider,
            pick_image_files,
            pick_video_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running RePix Local");
}

async fn initialize_state() -> errors::AppResult<AppState> {
    let workspace = workspace::Workspace::initialize().await?;
    let instance_lock = workspace::WorkspaceInstanceLock::acquire(&workspace)?;
    secrets::initialize_secret_storage(&workspace.root())?;
    let config = config::load_or_create(&workspace).await?;
    let repo = db::Repository::initialize(&workspace).await?;
    let assets = storage::local_assets::AssetManager::new(workspace.clone());
    Ok(AppState::new(
        workspace,
        instance_lock,
        config,
        repo,
        assets,
    ))
}
