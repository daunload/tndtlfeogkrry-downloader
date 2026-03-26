use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Listener, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct AuthTokens {
    cookies: String,
    xn_token: String,
    csrf_token: String,
}

#[tauri::command]
pub async fn open_login(app: AppHandle) -> AuthResult {
    // Set up a oneshot channel for the result
    let (tx, rx) = tokio::sync::oneshot::channel::<AuthResult>();
    let tx = std::sync::Arc::new(tokio::sync::Mutex::new(Some(tx)));

    // Listen for auth-tokens event from the JS in the login WebView
    let tx_event = tx.clone();
    let app_event = app.clone();
    let listener_id = app.listen("auth-tokens", move |event| {
        let payload = event.payload();
        if let Ok(tokens) = serde_json::from_str::<AuthTokens>(payload) {
            let tx_inner = tx_event.clone();
            let app_inner = app_event.clone();
            tauri::async_runtime::spawn(async move {
                // Store tokens in AppState
                let state = app_inner.state::<AppState>();
                state.set_cookies(tokens.cookies).await;
                state
                    .set_tokens(
                        if tokens.xn_token.is_empty() {
                            None
                        } else {
                            Some(tokens.xn_token)
                        },
                        if tokens.csrf_token.is_empty() {
                            None
                        } else {
                            Some(tokens.csrf_token)
                        },
                    )
                    .await;

                if let Some(tx) = tx_inner.lock().await.take() {
                    let _ = tx.send(AuthResult {
                        success: true,
                        error: None,
                    });
                }

                // Close login window
                if let Some(win) = app_inner.get_webview_window("login") {
                    let _ = win.close();
                }
            });
        }
    });

    // Prepare on_navigation callback to detect login success and inject JS
    let app_nav = app.clone();
    let nav_handler = move |url: &tauri::Url| {
        let url_str = url.to_string();
        if url_str.contains("login_success=1")
            || (url_str.contains("canvas.ssu.ac.kr") && !url_str.contains("/login"))
        {
            let app_inner = app_nav.clone();
            tauri::async_runtime::spawn(async move {
                // Small delay to let the page fully load after navigation
                tokio::time::sleep(std::time::Duration::from_millis(1500)).await;

                if let Some(win) = app_inner.get_webview_window("login") {
                    let js = r#"
                        (async function() {
                            const cookies = document.cookie;
                            const xnToken = cookies.match(/xn_api_token=([^;]+)/)?.[1] || '';
                            const csrfMeta = document.querySelector('meta[name="csrf-token"]');
                            const csrfToken = csrfMeta ? csrfMeta.content : (cookies.match(/_csrf_token=([^;]+)/)?.[1] || '');

                            if (window.__TAURI__) {
                                await window.__TAURI__.event.emit('auth-tokens', {
                                    cookies: cookies,
                                    xn_token: xnToken,
                                    csrf_token: csrfToken
                                });
                            }
                        })();
                    "#;
                    let _ = win.eval(js);
                }
            });
        }
        true // allow navigation
    };

    // Create login window with on_navigation handler on the builder
    let login_window = match WebviewWindowBuilder::new(
        &app,
        "login",
        WebviewUrl::External("https://canvas.ssu.ac.kr/login".parse().unwrap()),
    )
    .title("SSU LMS 로그인")
    .inner_size(1000.0, 700.0)
    .on_navigation(nav_handler)
    .build()
    {
        Ok(w) => w,
        Err(e) => {
            app.unlisten(listener_id);
            return AuthResult {
                success: false,
                error: Some(format!("로그인 창 생성 실패: {}", e)),
            };
        }
    };

    // Register window event handler on the built window to detect manual close
    let tx_close = tx.clone();
    login_window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            let tx_inner = tx_close.clone();
            tauri::async_runtime::spawn(async move {
                if let Some(tx) = tx_inner.lock().await.take() {
                    let _ = tx.send(AuthResult {
                        success: false,
                        error: Some("로그인 창이 닫혔습니다.".into()),
                    });
                }
            });
        }
    });

    // Wait for result with a 5-minute timeout
    let result = match tokio::time::timeout(std::time::Duration::from_secs(300), rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => AuthResult {
            success: false,
            error: Some("로그인 응답 수신 실패".into()),
        },
        Err(_) => {
            // Timeout -- close the login window if still open
            if let Some(win) = app.get_webview_window("login") {
                let _ = win.close();
            }
            AuthResult {
                success: false,
                error: Some("로그인 시간 초과".into()),
            }
        }
    };

    // Clean up the event listener
    app.unlisten(listener_id);

    result
}
