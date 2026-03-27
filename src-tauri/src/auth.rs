use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub const LMS_WINDOW_LABEL: &str = "lms";
const LMS_LOGIN_URL: &str = "https://canvas.ssu.ac.kr/login";
const LMS_DASHBOARD_URL: &str = "https://canvas.ssu.ac.kr/dashboard";

/// Rust로 메시지를 보내는 JS 헬퍼.
/// window.location.href = 'tauri-lms://ipc?...' 방식을 사용한다.
///   - fetch/XHR과 달리 navigation은 CSP connect-src의 영향을 받지 않음
///   - on_navigation에서 false를 반환하면 실제 페이지 이동은 발생하지 않음
const SEND_TO_RUST_FN: &str = r#"
function __sendToRust(data) {
    window.location.href = 'tauri-lms://ipc?' + encodeURIComponent(JSON.stringify(data));
}
"#;

/// initialization_script: 페이지 로드 시 Canvas 대시보드 여부를 확인하고
/// navigation 방식으로 인증 토큰을 Rust에 전달한다.
pub const LOGIN_DETECTION_SCRIPT: &str = r#"
(function() {
    function tryNotifyLogin() {
        var url = window.location.href;
        if (url.indexOf('canvas.ssu.ac.kr') === -1) return;
        if (url.indexOf('/login') !== -1) return;
        if (url.indexOf('saml') !== -1) return;
        if (window.__tauri_auth_notified) return;
        window.__tauri_auth_notified = true;

        var xnToken = (document.cookie.match(/xn_api_token=([^;]+)/) || [])[1] || '';
        var csrfMeta = document.querySelector('meta[name="csrf-token"]');
        var csrfToken = csrfMeta ? csrfMeta.getAttribute('content') : '';
        if (!csrfToken) {
            csrfToken = (document.cookie.match(/_csrf_token=([^;]+)/) || [])[1] || '';
        }

        var data = encodeURIComponent(JSON.stringify({
            type: 'auth',
            xn_token: xnToken,
            csrf_token: csrfToken
        }));
        window.location.href = 'tauri-lms://ipc?' + data;
    }

    if (document.readyState === 'complete') {
        tryNotifyLogin();
    } else {
        window.addEventListener('load', tryNotifyLogin);
    }
})();
"#;

/// `tauri-lms://ipc?ENCODED_JSON` 형태의 navigation URL에서 데이터를 파싱하여 처리한다.
pub async fn handle_lms_protocol_message(app: &AppHandle, msg: &str) {
    let Ok(data) = serde_json::from_str::<serde_json::Value>(msg) else {
        eprintln!("[LMS IPC] JSON 파싱 실패: {}", msg);
        return;
    };
    let msg_type = data
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let state = app.state::<AppState>();

    if msg_type == "auth" {
        if let Some(win) = app.get_webview_window(LMS_WINDOW_LABEL) {
            let _ = win.hide();
            *state.lms_window.lock().await = Some(win);
        }
        if let Some(tx) = state.auth_tx.lock().await.take() {
            let _ = tx.send(AuthResult {
                success: true,
                error: None,
            });
        }
    } else {
        let mut pending = state.pending_ipc.lock().await;
        if let Some(sender) = pending.remove(&msg_type) {
            let _ = sender.send(data);
        }
    }
}

/// LMS WebviewWindow에서 JS를 eval하고 IPC 결과를 기다린다.
pub async fn eval_lms(
    state: &AppState,
    request_id: &str,
    js: &str,
) -> Result<serde_json::Value, String> {
    let win = state
        .lms_window
        .lock()
        .await
        .clone()
        .ok_or_else(|| "로그인이 필요합니다.".to_string())?;

    let (tx, rx) = tokio::sync::oneshot::channel::<serde_json::Value>();
    state
        .pending_ipc
        .lock()
        .await
        .insert(request_id.to_string(), tx);

    // __sendToRust 헬퍼를 함께 주입
    let full_js = format!("{}\n{}", SEND_TO_RUST_FN, js);
    win.eval(&full_js)
        .map_err(|e| format!("JS 실행 실패: {}", e))?;

    tokio::time::timeout(std::time::Duration::from_secs(30), rx)
        .await
        .map_err(|_| "API 타임아웃".to_string())?
        .map_err(|_| "채널 수신 실패".to_string())
}

#[tauri::command]
pub async fn open_login(app: AppHandle) -> AuthResult {
    let (tx, rx) = tokio::sync::oneshot::channel::<AuthResult>();
    let state = app.state::<AppState>();
    *state.auth_tx.lock().await = Some(tx);

    // state.lms_window가 있으면 재사용, 없으면 setup에서 만든 창을 찾거나 새로 생성
    let win = {
        let stored = state.lms_window.lock().await.clone();
        stored
            .or_else(|| app.get_webview_window(LMS_WINDOW_LABEL))
            .unwrap_or_else(|| {
                let _ = create_lms_background_window(&app);
                app.get_webview_window(LMS_WINDOW_LABEL).expect("LMS 창 생성 실패")
            })
    };

    let _ = win.eval("window.__tauri_auth_notified = false;");
    if let Err(e) = win.navigate(LMS_LOGIN_URL.parse().unwrap()) {
        return AuthResult {
            success: false,
            error: Some(format!("창 이동 실패: {}", e)),
        };
    }
    let _ = win.show();

    match tokio::time::timeout(std::time::Duration::from_secs(300), rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => AuthResult {
            success: false,
            error: Some("로그인 응답 수신 실패".into()),
        },
        Err(_) => {
            if let Some(win) = app.get_webview_window(LMS_WINDOW_LABEL) {
                let _ = win.hide();
            }
            AuthResult {
                success: false,
                error: Some("로그인 시간 초과".into()),
            }
        }
    }
}

/// 앱 시작 시 백그라운드 LMS WebviewWindow를 생성한다.
/// on_navigation으로 'tauri-lms://ipc?...' URL을 인터셉트하여 IPC 메시지를 처리한다.
pub fn create_lms_background_window(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let app_nav = app.clone();

    WebviewWindowBuilder::new(
        app,
        LMS_WINDOW_LABEL,
        WebviewUrl::External(LMS_DASHBOARD_URL.parse().unwrap()),
    )
    .title("LMS Session")
    .inner_size(1000.0, 700.0)
    .visible(false)
    .initialization_script(LOGIN_DETECTION_SCRIPT)
    .on_navigation(move |url| {
        // tauri-lms://ipc?ENCODED_JSON 형태의 IPC 메시지 인터셉트
        if url.scheme() == "tauri-lms" {
            if let Some(query) = url.query() {
                if let Ok(decoded) = urlencoding::decode(query) {
                    let msg = decoded.to_string();
                    let app_clone = app_nav.clone();
                    tauri::async_runtime::spawn(async move {
                        handle_lms_protocol_message(&app_clone, &msg).await;
                    });
                }
            }
            return false; // 실제 navigation 차단 (페이지 이동 없음)
        }
        true
    })
    .build()?;
    Ok(())
}
