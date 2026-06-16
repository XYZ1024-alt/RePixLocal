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
    cancel_task, check_ffmpeg, create_task, get_settings, get_task, list_assets, list_tasks,
    save_provider_credential, start_task, test_provider, update_settings,
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
            list_tasks,
            get_task,
            start_task,
            cancel_task,
            list_assets,
            check_ffmpeg,
            get_settings,
            update_settings,
            save_provider_credential,
            test_provider
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
