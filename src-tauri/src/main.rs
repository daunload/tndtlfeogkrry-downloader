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
        .setup(|app| {
            // 앱 시작 시 백그라운드 LMS 창 생성.
            // WebView 쿠키 저장소가 영구적이므로 이전 로그인 세션이 자동 복원된다.
            if let Err(e) = auth::create_lms_background_window(&app.handle()) {
                eprintln!("LMS 창 초기화 실패: {}", e);
            }
            Ok(())
        })
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
