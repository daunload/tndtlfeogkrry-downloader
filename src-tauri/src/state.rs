use std::sync::Arc;
use reqwest::cookie::Jar;
use tokio::sync::Mutex;

/// 앱 전역 상태. Tauri의 manage()로 등록하여 커맨드에서 접근한다.
pub struct AppState {
    /// Canvas LMS 인증 쿠키를 저장하는 cookie jar
    pub cookie_jar: Arc<Jar>,
    /// Canvas API 인증 토큰 (xn_api_token)
    pub xn_api_token: Mutex<Option<String>>,
    /// Canvas CSRF 토큰
    pub csrf_token: Mutex<Option<String>>,
    /// 쿠키 문자열 (WebView에서 추출)
    pub cookies: Mutex<Option<String>>,
    /// 인증된 reqwest 클라이언트 (cookie jar 공유)
    pub http_client: reqwest::Client,
}

impl AppState {
    pub fn new() -> Self {
        let jar = Arc::new(Jar::default());
        let client = reqwest::Client::builder()
            .cookie_provider(jar.clone())
            .build()
            .expect("failed to create HTTP client");

        Self {
            cookie_jar: jar,
            xn_api_token: Mutex::new(None),
            csrf_token: Mutex::new(None),
            cookies: Mutex::new(None),
            http_client: client,
        }
    }

    pub async fn get_cookies(&self) -> String {
        self.cookies.lock().await.clone().unwrap_or_default()
    }

    pub async fn set_cookies(&self, cookies: String) {
        *self.cookies.lock().await = Some(cookies);
    }

    pub async fn set_tokens(&self, xn_token: Option<String>, csrf_token: Option<String>) {
        *self.xn_api_token.lock().await = xn_token;
        *self.csrf_token.lock().await = csrf_token;
    }
}
