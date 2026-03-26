mod auth;
mod config;
mod download;
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
        .invoke_handler(tauri::generate_handler![auth::open_login])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
