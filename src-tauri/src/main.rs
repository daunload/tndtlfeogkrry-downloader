mod auth;
mod commands;
mod config;
mod download;
mod gemini;
mod history;
mod lms;
mod media;
mod state;

use state::AppState;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            auth::open_login,
            commands::fetch_courses,
            commands::fetch_modules,
            commands::download_video,
            commands::download_all,
            commands::transcribe_audio,
            commands::get_gemini_model_options,
            commands::get_history,
            commands::remove_history_record,
            commands::download_wiki_file,
            commands::summarize_wiki_pdf,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
