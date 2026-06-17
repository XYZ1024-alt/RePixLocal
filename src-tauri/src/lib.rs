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
    cancel_task, check_ffmpeg, create_task, get_dashboard_data, get_dashboard_summary,
    get_latest_run, get_run, get_run_costs, get_settings, get_task, list_all_assets, list_assets,
    list_logs, list_provider_credentials, list_provider_models, list_run_stages, list_runs,
    list_tasks, pick_video_file, save_provider_credential, start_task, submit_task, test_provider,
    update_settings,
};
use state::AppState;

pub fn run() {
    tracing_subscriber::fmt::init();
    let state = tauri::async_runtime::block_on(initialize_state())
        .expect("failed to initialize RePix Local state");

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            create_task,
            get_dashboard_summary,
            get_dashboard_data,
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
            list_run_stages,
            list_logs,
            check_ffmpeg,
            get_settings,
            update_settings,
            save_provider_credential,
            list_provider_credentials,
            list_provider_models,
            test_provider,
            pick_video_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running RePix Local");
}

async fn initialize_state() -> errors::AppResult<AppState> {
    let workspace = workspace::Workspace::initialize().await?;
    let config = config::load_or_create(&workspace).await?;
    let repo = db::Repository::initialize(&workspace).await?;
    let assets = storage::local_assets::AssetManager::new(workspace.clone());
    let ffmpeg = media::ffmpeg::FfmpegRunner::detect();
    Ok(AppState::new(workspace, config, repo, assets, ffmpeg))
}
