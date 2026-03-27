use std::collections::HashMap;
use tokio::sync::{oneshot, Mutex};

use crate::auth::AuthResult;

/// 앱 전역 상태. Tauri의 manage()로 등록하여 커맨드에서 접근한다.
pub struct AppState {
    /// Canvas LMS WebviewWindow (로그인 후 숨겨서 유지 — API 호출에 사용)
    pub lms_window: Mutex<Option<tauri::WebviewWindow>>,
    /// open_login 대기 채널 (로그인 완료 신호 전달)
    pub auth_tx: Mutex<Option<oneshot::Sender<AuthResult>>>,
    /// 대기 중인 IPC 요청 채널 (request_id → sender)
    pub pending_ipc: Mutex<HashMap<String, oneshot::Sender<serde_json::Value>>>,
    /// reqwest HTTP 클라이언트 (파일 다운로드 등)
    pub http_client: reqwest::Client,
}

impl AppState {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .build()
            .expect("failed to create HTTP client");

        Self {
            lms_window: Mutex::new(None),
            auth_tx: Mutex::new(None),
            pending_ipc: Mutex::new(HashMap::new()),
            http_client: client,
        }
    }
}
