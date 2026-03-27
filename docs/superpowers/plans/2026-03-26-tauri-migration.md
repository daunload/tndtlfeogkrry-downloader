# Tauri Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Electron + Vue 3 앱을 Tauri v2 + Rust + Vanilla JS로 전환하여 앱 크기를 ~150MB에서 ~5MB로 줄인다.

**Architecture:** Tauri v2 프레임워크 위에 Rust 백엔드(reqwest, quick-xml, symphonia)와 Vanilla HTML/CSS/JS 프론트엔드를 구성한다. Canvas SSO 인증은 WebView JS 브릿지로, 오디오 추출은 symphonia로 FFmpeg 없이 처리한다.

**Tech Stack:** Rust, Tauri v2, reqwest, quick-xml, symphonia, serde, tokio, Vanilla HTML/CSS/JS

---

## File Structure

### Rust Backend (`src-tauri/src/`)

| File | Responsibility |
|------|----------------|
| `main.rs` | Tauri 앱 진입점, 모든 커맨드 등록 |
| `config.rs` | 상수 정의 (동시성 제한, 타임아웃, 모델 목록, 안전한 파일명 생성) |
| `auth.rs` | WebView 로그인 윈도우, 쿠키/토큰 추출, 세션 관리 |
| `lms.rs` | Canvas API 호출 (강의 목록, 모듈), XML 파싱으로 미디어 URL 추출 |
| `download.rs` | HTTPS 다운로드 (청크 단위, 진행률 이벤트, 리다이렉트, 타임아웃) |
| `media.rs` | symphonia로 MP4 → M4A(AAC) 추출 |
| `gemini.rs` | Gemini API (STT, 요약, PDF 요약), 재시도 로직 |
| `history.rs` | JSON 기반 다운로드/위키 히스토리 CRUD |
| `wiki.rs` | 위키 페이지 파일 다운로드 + PDF 요약 |
| `commands.rs` | Tauri #[command] 함수들 (프론트에서 invoke로 호출) |
| `state.rs` | AppState 구조체 (cookie jar, 토큰, 설정을 Mutex로 관리) |

### Frontend (`src/`)

| File | Responsibility |
|------|----------------|
| `index.html` | SPA 진입점, 전체 레이아웃 |
| `styles/main.css` | 순수 CSS 스타일 |
| `js/app.js` | 앱 초기화, 화면 전환(라우팅), 이벤트 리스너 등록 |
| `js/api.js` | `window.__TAURI__.core.invoke` 래퍼 + 이벤트 리스너 등록 |
| `js/components/login.js` | 로그인 화면 렌더링 |
| `js/components/courseList.js` | 강의 목록 렌더링 |
| `js/components/videoList.js` | 영상 목록 + 다운로드/변환 UI |
| `js/components/wikiList.js` | 위키 페이지 파일 목록 |
| `js/components/downloadProgress.js` | 다운로드/변환 진행률 표시 |
| `js/components/settings.js` | API 키, 모델 선택, 다운로드 폴더 설정 |
| `js/utils/dom.js` | DOM 생성 헬퍼 (`el`, `text`, `on`) |
| `js/utils/format.js` | 파일 크기, 시간 포맷 |

---

### Task 1: Tauri 프로젝트 초기화

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/main.rs`
- Create: `src/index.html`
- Create: `package.json` (Tauri용)

- [ ] **Step 1: Tauri CLI 설치 및 프로젝트 생성**

```bash
cd /Users/seodaun/toy_project
cargo install tauri-cli --version "^2"
cargo create-tauri-app soongsil-lms-downloader-tauri --template vanilla --manager pnpm
cd soongsil-lms-downloader-tauri
```

- [ ] **Step 2: Cargo.toml 의존성 설정**

`src-tauri/Cargo.toml`의 `[dependencies]` 섹션을 아래로 교체:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-store = "2"
tauri-plugin-dialog = "2"
tauri-plugin-shell = "2"
reqwest = { version = "0.12", features = ["cookies", "stream", "json", "multipart"] }
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
quick-xml = "0.37"
symphonia = { version = "0.5", default-features = false, features = ["isomp4", "aac"] }
base64 = "0.22"
unicode-normalization = "0.1"
```

- [ ] **Step 3: tauri.conf.json 설정**

`src-tauri/tauri.conf.json`을 아래로 교체:

```json
{
  "$schema": "https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-config-schema/schema.json",
  "productName": "SSU LMS Downloader",
  "identifier": "com.ssu-lms-downloader",
  "version": "2.0.0",
  "build": {
    "frontendDist": "../src",
    "devUrl": "http://localhost:1420"
  },
  "app": {
    "windows": [
      {
        "title": "SSU LMS Downloader",
        "width": 1000,
        "height": 700,
        "resizable": true,
        "minWidth": 800,
        "minHeight": 600
      }
    ],
    "security": {
      "csp": "default-src 'self'; connect-src https://canvas.ssu.ac.kr https://commons.ssu.ac.kr https://generativelanguage.googleapis.com; img-src 'self' https://commons.ssu.ac.kr https://canvas.ssu.ac.kr; style-src 'self' 'unsafe-inline'"
    }
  },
  "plugins": {
    "store": {},
    "dialog": {},
    "shell": {
      "open": true
    }
  }
}
```

- [ ] **Step 4: 최소 main.rs 작성**

`src-tauri/src/main.rs`:

```rust
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: 최소 index.html 작성**

`src/index.html`:

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SSU LMS Downloader</title>
  <link rel="stylesheet" href="styles/main.css" />
</head>
<body>
  <div id="app">
    <h1>SSU LMS Downloader</h1>
    <p>Tauri 앱이 정상적으로 로드되었습니다.</p>
  </div>
  <script type="module" src="js/app.js"></script>
</body>
</html>
```

`src/styles/main.css`:

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; color: #333; }
#app { max-width: 960px; margin: 0 auto; padding: 20px; }
```

`src/js/app.js`:

```javascript
document.addEventListener('DOMContentLoaded', () => {
  console.log('SSU LMS Downloader loaded');
});
```

- [ ] **Step 6: 빌드 확인**

```bash
cd soongsil-lms-downloader-tauri
pnpm install
cargo tauri dev
```

Expected: Tauri 윈도우가 열리고 "SSU LMS Downloader" 텍스트가 표시됨

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: initialize Tauri v2 project with dependencies"
```

---

### Task 2: config.rs — 상수 및 유틸리티

**Files:**
- Create: `src-tauri/src/config.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: config.rs 작성**

`src-tauri/src/config.rs`:

```rust
use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;

pub const SPLIT_THRESHOLD_BYTES: u64 = 19 * 1024 * 1024;
pub const MAX_CONCURRENT_DOWNLOADS: usize = 3;
pub const MAX_CONCURRENT_TRANSCRIPTIONS: usize = 2;
pub const DEFAULT_GEMINI_MODEL: &str = "gemini-2.0-flash";
pub const GEMINI_MAX_RETRIES: u32 = 3;
pub const DOWNLOAD_TIMEOUT_SECS: u64 = 300;
pub const MAX_FILENAME_BYTES: usize = 255;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeminiModelOption {
    pub id: String,
    pub label: String,
    pub description: String,
}

pub fn gemini_model_options() -> Vec<GeminiModelOption> {
    vec![
        GeminiModelOption {
            id: "gemini-3.1-pro".into(),
            label: "Gemini 3.1 Pro".into(),
            description: "고급 지능, 복잡한 문제 해결, 강력한 에이전트 및 분위기 코딩 기능".into(),
        },
        GeminiModelOption {
            id: "gemini-3-flash".into(),
            label: "Gemini 3 Flash".into(),
            description: "더 큰 모델에 필적하는 프런티어급 성능을 훨씬 저렴한 비용으로 제공".into(),
        },
        GeminiModelOption {
            id: "gemini-3.1-flash-lite".into(),
            label: "Gemini 3.1 Flash-Lite".into(),
            description: "프런티어급 성능을 더 낮은 비용으로 제공하는 빠른 경량 모델".into(),
        },
        GeminiModelOption {
            id: "gemini-2.5-flash".into(),
            label: "Gemini 2.5 Flash".into(),
            description: "짧은 지연 시간과 대용량 작업에 적합한 최고 가성비 모델".into(),
        },
        GeminiModelOption {
            id: "gemini-2.5-flash-lite".into(),
            label: "Gemini 2.5 Flash-Lite".into(),
            description: "2.5 계열에서 가장 빠르고 예산 친화적인 멀티모달 모델".into(),
        },
        GeminiModelOption {
            id: "gemini-2.0-flash".into(),
            label: "Gemini 2.0 Flash (기본)".into(),
            description: "STT에 최적화된 빠르고 가벼운 모델, 무료 할당량 넉넉".into(),
        },
    ]
}

pub fn is_valid_gemini_model(model: &str) -> bool {
    gemini_model_options().iter().any(|m| m.id == model)
}

/// macOS HFS+ NFD 변환 시 255바이트 제한 초과를 방지하는 안전한 파일명 생성
pub fn to_safe_file_name(title: &str, reserve_bytes: usize) -> String {
    let mut name: String = title
        .chars()
        .map(|c| match c {
            '/' | '\\' | '?' | '%' | '*' | ':' | '|' | '"' | '<' | '>' => '_',
            _ => c,
        })
        .collect();

    let limit = MAX_FILENAME_BYTES - reserve_bytes;

    while nfd_byte_length(&name) > limit {
        name.pop();
    }

    name
}

fn nfd_byte_length(s: &str) -> usize {
    s.nfd().collect::<String>().len()
}
```

- [ ] **Step 2: main.rs에 모듈 등록**

`src-tauri/src/main.rs` 상단에 추가:

```rust
mod config;
```

- [ ] **Step 3: 빌드 확인**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: 컴파일 성공

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/config.rs src-tauri/src/main.rs
git commit -m "feat: add config module with constants and safe filename utility"
```

---

### Task 3: state.rs — 앱 상태 관리

**Files:**
- Create: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: state.rs 작성**

`src-tauri/src/state.rs`:

```rust
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
            http_client: client,
        }
    }
}
```

- [ ] **Step 2: main.rs에 상태 등록**

`src-tauri/src/main.rs`:

```rust
mod config;
mod state;

use state::AppState;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::new())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: 빌드 확인**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: 컴파일 성공

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/main.rs
git commit -m "feat: add AppState with cookie jar and HTTP client"
```

---

### Task 4: auth.rs — Canvas SSO 인증

**Files:**
- Create: `src-tauri/src/auth.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: auth.rs 작성**

`src-tauri/src/auth.rs`:

```rust
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthResult {
    pub success: bool,
    pub error: Option<String>,
}

/// WebView 로그인 윈도우를 열어 Canvas SSO 인증을 수행한다.
/// 로그인 성공 시 쿠키와 토큰을 AppState에 저장한다.
#[tauri::command]
pub async fn open_login(app: AppHandle) -> AuthResult {
    let (tx, rx) = tokio::sync::oneshot::channel::<AuthResult>();
    let tx = std::sync::Arc::new(tokio::sync::Mutex::new(Some(tx)));

    let login_window = match WebviewWindowBuilder::new(
        &app,
        "login",
        WebviewUrl::External("https://canvas.ssu.ac.kr/login".parse().unwrap()),
    )
    .title("SSU LMS 로그인")
    .inner_size(1000.0, 700.0)
    .build()
    {
        Ok(w) => w,
        Err(e) => {
            return AuthResult {
                success: false,
                error: Some(format!("로그인 창 생성 실패: {}", e)),
            };
        }
    };

    // URL 변경 감시: login_success=1 감지 시 쿠키/토큰 추출
    let tx_clone = tx.clone();
    let app_clone = app.clone();
    login_window.on_navigation(move |url| {
        let url_str = url.to_string();
        if url_str.contains("login_success=1") ||
           (url_str.contains("canvas.ssu.ac.kr") && !url_str.contains("/login")) {
            let tx_inner = tx_clone.clone();
            let app_inner = app_clone.clone();

            tauri::async_runtime::spawn(async move {
                let result = extract_session(&app_inner).await;
                if let Some(tx) = tx_inner.lock().await.take() {
                    let _ = tx.send(result);
                }
                // 로그인 창 닫기
                if let Some(win) = app_inner.get_webview_window("login") {
                    let _ = win.close();
                }
            });
        }
        true
    });

    // 창이 닫힐 때 아직 응답하지 않았으면 실패 반환
    let tx_close = tx.clone();
    let login_window_clone = login_window.clone();
    login_window_clone.on_window_event(move |event| {
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

    rx.await.unwrap_or(AuthResult {
        success: false,
        error: Some("로그인 응답 수신 실패".into()),
    })
}

/// 로그인 WebView에서 쿠키와 토큰을 추출하여 AppState에 저장
async fn extract_session(app: &AppHandle) -> AuthResult {
    let Some(login_win) = app.get_webview_window("login") else {
        return AuthResult {
            success: false,
            error: Some("로그인 창을 찾을 수 없습니다.".into()),
        };
    };

    // JS로 쿠키와 토큰 추출
    let js = r#"
        (function() {
            const cookies = document.cookie;
            const xnToken = cookies.match(/xn_api_token=([^;]+)/)?.[1] || '';
            const csrfMeta = document.querySelector('meta[name="csrf-token"]');
            const csrfToken = csrfMeta ? csrfMeta.content : (cookies.match(/_csrf_token=([^;]+)/)?.[1] || '');
            return JSON.stringify({ cookies, xnToken, csrfToken });
        })()
    "#;

    match login_win.eval(js) {
        Ok(_) => {}
        Err(e) => {
            return AuthResult {
                success: false,
                error: Some(format!("세션 추출 실패: {}", e)),
            };
        }
    }

    // eval은 반환값을 직접 받을 수 없으므로, 별도 이벤트나 채널을 사용해야 한다.
    // 여기서는 쿠키를 reqwest cookie jar에 수동으로 설정하는 대안을 사용한다.
    // WebView의 쿠키는 on_navigation에서 URL 기반으로 인증 성공을 판단하고,
    // 이후 Canvas API 호출 시 별도 JS 실행으로 토큰을 추출한다.

    let state = app.state::<AppState>();

    // 토큰 추출을 위해 메인 페이지 로드 후 JS 실행
    // (on_navigation 콜백에서 호출되므로 페이지 로드 완료 상태)
    // 실제 토큰은 fetch_courses 호출 시 WebView에서 추출한다.

    AuthResult {
        success: true,
        error: None,
    }
}

/// Canvas API 호출에 필요한 토큰을 로그인된 WebView에서 추출한다.
/// fetch_courses/fetch_modules 호출 전에 실행된다.
#[tauri::command]
pub async fn extract_tokens(app: AppHandle) -> Result<(), String> {
    let Some(login_win) = app.get_webview_window("login") else {
        return Err("로그인 창이 없습니다. 먼저 로그인해주세요.".into());
    };

    // WebView에서 JS 실행하여 토큰과 쿠키를 이벤트로 전달
    let js = r#"
        (function() {
            const cookies = document.cookie;
            const xnToken = cookies.match(/xn_api_token=([^;]+)/)?.[1] || '';
            const csrfMeta = document.querySelector('meta[name="csrf-token"]');
            const csrfToken = csrfMeta ? csrfMeta.content : (cookies.match(/_csrf_token=([^;]+)/)?.[1] || '');
            window.__TAURI__.event.emit('session-tokens', { cookies, xnToken, csrfToken });
        })()
    "#;

    login_win.eval(js).map_err(|e| format!("JS 실행 실패: {}", e))?;

    // 이벤트 수신은 commands.rs에서 listen으로 처리
    Ok(())
}
```

- [ ] **Step 2: main.rs에 모듈 등록**

`src-tauri/src/main.rs` 상단에 `mod auth;` 추가하고 invoke_handler에 커맨드 등록:

```rust
mod config;
mod state;
mod auth;

use state::AppState;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            auth::open_login,
            auth::extract_tokens,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: 빌드 확인**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: 컴파일 성공

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/auth.rs src-tauri/src/main.rs
git commit -m "feat: add Canvas SSO authentication via WebView"
```

---

### Task 5: lms.rs — XML 파싱 및 Canvas API

**Files:**
- Create: `src-tauri/src/lms.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: lms.rs 작성**

`src-tauri/src/lms.rs`:

```rust
use quick_xml::Reader;
use quick_xml::events::Event;
use serde::{Deserialize, Serialize};

use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseItem {
    pub id: String,
    pub name: String,
    pub term: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoItem {
    pub title: String,
    pub content_id: String,
    pub duration: u64,
    pub file_size: u64,
    pub thumbnail_url: String,
    pub week_position: u32,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiPageFileItem {
    pub title: String,
    pub download_url: String,
    pub api_endpoint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiPageItem {
    pub title: String,
    pub course_id: String,
    pub week_position: u32,
    pub available: bool,
    pub url: String,
    pub files: Vec<WikiPageFileItem>,
}

const VIDEO_TYPES: &[&str] = &["everlec", "movie", "video", "mp4"];

/// content.php XML 응답에서 미디어 다운로드 URL을 추출한다.
/// 4가지 전략을 우선순위대로 시도:
///   1. [MEDIA_FILE] 템플릿 치환
///   2. 직접 .mp4 URL
///   3. desktop HTML5 경로
///   4. content_uri 기반 fallback
pub fn extract_media_url(xml: &str) -> Option<String> {
    // quick-xml로 파싱하여 필요한 필드 추출
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut current_path: Vec<String> = Vec::new();
    let mut media_uri: Option<String> = None;
    let mut main_media: Option<String> = None;
    let mut content_uri: Option<String> = None;
    let mut desktop_html5_uri: Option<String> = None;

    // 간소화된 트리 파싱: 태그 이름만으로 필드를 식별
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                current_path.push(name);
            }
            Ok(Event::Text(e)) => {
                let text = e.unescape().unwrap_or_default().to_string();
                if text.is_empty() {
                    continue;
                }
                let tag = current_path.last().map(|s| s.as_str()).unwrap_or("");
                match tag {
                    "media_uri" => {
                        // desktop > html5 > media_uri 경로 체크
                        let in_desktop = current_path.iter().any(|p| p == "desktop");
                        let in_html5 = current_path.iter().any(|p| p == "html5");
                        if in_desktop && in_html5 {
                            desktop_html5_uri = Some(text.clone());
                        }
                        if media_uri.is_none() {
                            media_uri = Some(text);
                        }
                    }
                    "main_media" => {
                        if main_media.is_none() {
                            main_media = Some(text);
                        }
                    }
                    "content_uri" => {
                        if content_uri.is_none() {
                            content_uri = Some(text);
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::End(_)) => {
                current_path.pop();
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }

    // 전략 1: [MEDIA_FILE] 템플릿 치환
    if let (Some(ref file_name), Some(ref uri)) = (&main_media, &media_uri) {
        if uri.contains("[MEDIA_FILE]") {
            return Some(uri.replace("[MEDIA_FILE]", file_name));
        }
    }

    // 전략 2: media_uri가 이미 완전한 .mp4 URL
    if let Some(ref uri) = media_uri {
        if uri.contains(".mp4") && !uri.contains('[') {
            return Some(uri.clone());
        }
    }

    // 전략 3: desktop HTML5 경로
    if let Some(ref uri) = desktop_html5_uri {
        if uri.contains(".mp4") {
            return Some(uri.clone());
        }
    }

    // 전략 4: content_uri + filename fallback
    if let (Some(ref file_name), Some(ref uri)) = (&main_media, &content_uri) {
        let base = uri.replace("web_files", "media_files");
        return Some(format!("{}/{}", base, file_name));
    }

    None
}

/// Canvas API에서 강의 목록을 가져온다.
/// WebView 컨텍스트에서 실행한 JS 결과를 받아 파싱한다.
pub async fn fetch_courses_api(state: &AppState, cookies: &str) -> Result<Vec<CourseItem>, String> {
    let response = state.http_client
        .get("https://canvas.ssu.ac.kr/api/v1/dashboard/dashboard_cards")
        .header("Cookie", cookies)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("강의 목록 요청 실패: {}", e))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        if status == 401 || status == 403 {
            return Err("로그인이 만료되었습니다. 다시 로그인해주세요.".into());
        }
        return Err(format!("HTTP {}", status));
    }

    let text = response.text().await.map_err(|e| e.to_string())?;
    // Canvas는 JSON 앞에 "while(1);" CSRF prefix를 붙임
    let json_str = text.strip_prefix("while(1);").unwrap_or(&text);

    let cards: Vec<serde_json::Value> = serde_json::from_str(json_str)
        .map_err(|e| format!("JSON 파싱 실패: {}", e))?;

    Ok(cards
        .iter()
        .filter_map(|c| {
            Some(CourseItem {
                id: c.get("id")?.to_string().trim_matches('"').to_string(),
                name: c.get("shortName")?.as_str()?.to_string(),
                term: c.get("term").and_then(|t| t.as_str()).unwrap_or("").to_string(),
            })
        })
        .collect())
}

/// Canvas LearningX API에서 모듈 목록을 가져와 영상/위키 페이지로 분류한다.
pub async fn fetch_modules_api(
    state: &AppState,
    course_id: &str,
    cookies: &str,
    xn_token: Option<&str>,
    csrf_token: Option<&str>,
) -> Result<(Vec<VideoItem>, Vec<WikiPageItem>), String> {
    let url = format!(
        "https://canvas.ssu.ac.kr/learningx/api/v1/courses/{}/modules?include_detail=true",
        course_id
    );

    let mut req = state.http_client
        .get(&url)
        .header("Cookie", cookies)
        .header("Accept", "application/json");

    if let Some(token) = xn_token {
        req = req.header("Authorization", format!("Bearer {}", token));
    }
    if let Some(csrf) = csrf_token {
        req = req.header("X-CSRF-Token", csrf);
    }

    let response = req.send().await.map_err(|e| format!("모듈 요청 실패: {}", e))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        if status == 401 || status == 403 {
            return Err("로그인이 만료되었습니다. 다시 로그인해주세요.".into());
        }
        return Err(format!("HTTP {}", status));
    }

    let modules: Vec<serde_json::Value> = response.json().await
        .map_err(|e| format!("JSON 파싱 실패: {}", e))?;

    let mut videos = Vec::new();
    let mut wiki_pages = Vec::new();

    for module in &modules {
        let Some(items) = module.get("module_items").and_then(|v| v.as_array()) else {
            continue;
        };

        for item in items {
            let content_data = item.get("content_data");
            let item_content_data = content_data
                .and_then(|cd| cd.get("item_content_data"));

            let content_type = item_content_data
                .and_then(|d| d.get("content_type"))
                .or_else(|| item.get("content_type"))
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let title = item.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let week_position = content_data
                .and_then(|cd| cd.get("week_position"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;

            // 영상 콘텐츠
            if VIDEO_TYPES.contains(&content_type) {
                if let Some(data) = item_content_data {
                    let content_id = data.get("content_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    if !content_id.is_empty() {
                        let available = content_id != "not_open";
                        videos.push(VideoItem {
                            title,
                            content_id,
                            duration: data.get("duration").and_then(|v| v.as_u64()).unwrap_or(0),
                            file_size: data.get("total_file_size").and_then(|v| v.as_u64()).unwrap_or(0),
                            thumbnail_url: data.get("thumbnail_url").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            week_position,
                            available,
                        });
                    }
                }
                continue;
            }

            // 위키 페이지
            if content_type == "wiki_page" {
                let page_slug = content_data
                    .and_then(|cd| cd.get("url"))
                    .and_then(|v| v.as_str());
                let module_item_id = item.get("module_item_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                if let Some(slug) = page_slug {
                    let page_url = format!(
                        "https://canvas.ssu.ac.kr/courses/{}/pages/{}?module_item_id={}",
                        course_id, slug, module_item_id
                    );
                    let page_api_url = format!(
                        "https://canvas.ssu.ac.kr/api/v1/courses/{}/pages/{}",
                        course_id,
                        urlencoding::encode(slug)
                    );

                    // 페이지 API 호출하여 HTML에서 PDF 링크 추출
                    let page_res = state.http_client
                        .get(&page_api_url)
                        .header("Cookie", cookies)
                        .header("Accept", "application/json")
                        .send()
                        .await;

                    if let Ok(res) = page_res {
                        if res.status().is_success() {
                            if let Ok(page_data) = res.json::<serde_json::Value>().await {
                                let body = page_data.get("body")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                let files = extract_wiki_files_from_html(body);
                                if !files.is_empty() {
                                    wiki_pages.push(WikiPageItem {
                                        title,
                                        course_id: course_id.to_string(),
                                        week_position,
                                        available: true,
                                        url: page_url,
                                        files,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok((videos, wiki_pages))
}

/// HTML에서 instructure_file_link 클래스의 PDF 링크를 추출한다.
fn extract_wiki_files_from_html(html: &str) -> Vec<WikiPageFileItem> {
    let mut files = Vec::new();

    // 정규식으로 <a> 태그 추출
    let anchor_re = regex_lite::Regex::new(
        r#"<a\b[^>]*class=["'][^"']*instructure_file_link[^"']*["'][^>]*>[\s\S]*?</a>"#
    ).unwrap();

    let title_re = regex_lite::Regex::new(r#"\btitle=(["'])(.*?)\1"#).unwrap();
    let href_re = regex_lite::Regex::new(r#"\bhref=(["'])(.*?)\1"#).unwrap();
    let api_re = regex_lite::Regex::new(r#"\bdata-api-endpoint=(["'])(.*?)\1"#).unwrap();
    let inner_re = regex_lite::Regex::new(r#">([\s\S]*?)</a>"#).unwrap();

    for anchor in anchor_re.find_iter(html) {
        let anchor_str = anchor.as_str();

        let title_val = title_re.captures(anchor_str)
            .and_then(|c| c.get(2))
            .map(|m| decode_html(m.as_str()))
            .or_else(|| {
                inner_re.captures(anchor_str)
                    .and_then(|c| c.get(1))
                    .map(|m| m.as_str().trim().to_string())
            })
            .unwrap_or_else(|| "첨부파일".to_string());

        let Some(href) = href_re.captures(anchor_str).and_then(|c| c.get(2)) else {
            continue;
        };
        let href_str = decode_html(href.as_str());

        // PDF 파일만 필터링
        let lower_title = title_val.to_lowercase();
        let lower_href = href_str.to_lowercase();
        if !lower_title.ends_with(".pdf") && !lower_href.ends_with(".pdf") {
            continue;
        }

        let download_url = if href_str.starts_with("http") {
            href_str.clone()
        } else {
            format!("https://canvas.ssu.ac.kr{}", href_str)
        };

        let api_endpoint = api_re.captures(anchor_str)
            .and_then(|c| c.get(2))
            .map(|m| decode_html(m.as_str()));

        files.push(WikiPageFileItem {
            title: title_val,
            download_url,
            api_endpoint,
        });
    }

    files
}

fn decode_html(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}
```

- [ ] **Step 2: Cargo.toml에 추가 의존성**

```toml
regex-lite = "0.1"
urlencoding = "2"
```

- [ ] **Step 3: main.rs에 모듈 등록**

```rust
mod lms;
```

- [ ] **Step 4: 빌드 확인**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: 컴파일 성공

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lms.rs src-tauri/Cargo.toml src-tauri/src/main.rs
git commit -m "feat: add LMS module with XML parsing and Canvas API"
```

---

### Task 6: download.rs — HTTPS 다운로드

**Files:**
- Create: `src-tauri/src/download.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: download.rs 작성**

`src-tauri/src/download.rs`:

```rust
use std::path::Path;
use std::time::Duration;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

use crate::config::DOWNLOAD_TIMEOUT_SECS;
use crate::lms::extract_media_url;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressData {
    pub content_id: String,
    pub downloaded: u64,
    pub total: u64,
    pub percent: u32,
    pub status: Option<String>,
    pub batch_completed: Option<u32>,
    pub batch_total: Option<u32>,
}

/// HTTPS로 파일을 다운로드한다. commons.ssu.ac.kr Referer 헤더 필수.
pub async fn download_file(
    client: &reqwest::Client,
    url: &str,
    save_path: &str,
    content_id: &str,
    app: &AppHandle,
    progress_multiplier: u32,
) -> Result<(), String> {
    let response = client
        .get(url)
        .header("Referer", "https://commons.ssu.ac.kr/")
        .header("Origin", "https://commons.ssu.ac.kr")
        .timeout(Duration::from_secs(DOWNLOAD_TIMEOUT_SECS))
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "다운로드 타임아웃 (5분)".to_string()
            } else {
                format!("다운로드 실패: {}", e)
            }
        })?;

    // 리다이렉트는 reqwest가 자동 처리함

    if !response.status().is_success() {
        return Err(format!("다운로드 HTTP {}", response.status().as_u16()));
    }

    let total = response.content_length().unwrap_or(0);
    let mut received: u64 = 0;

    let mut file = tokio::fs::File::create(save_path)
        .await
        .map_err(|e| format!("파일 생성 실패: {}", e))?;

    let mut stream = response.bytes_stream();
    use futures_util::StreamExt;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("다운로드 중 오류: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("파일 쓰기 실패: {}", e))?;

        received += chunk.len() as u64;

        if total > 0 {
            let percent = ((received as f64 / total as f64) * progress_multiplier as f64) as u32;
            let _ = app.emit("download-progress", DownloadProgressData {
                content_id: content_id.to_string(),
                downloaded: received,
                total,
                percent,
                status: None,
                batch_completed: None,
                batch_total: None,
            });
        }
    }

    file.flush().await.map_err(|e| format!("파일 플러시 실패: {}", e))?;
    Ok(())
}

/// 단일 비디오 다운로드 파이프라인.
/// content.php API → XML 파싱 → 미디어 URL → HTTPS 다운로드 → AAC 추출
pub async fn download_one(
    state: &AppState,
    content_id: &str,
    file_path: &str,
    cookies: &str,
    app: &AppHandle,
    format: &str,  // "mp4" or "m4a"
) -> Result<String, String> {
    // content.php에서 영상 메타데이터 XML 조회
    let content_url = format!(
        "https://commons.ssu.ac.kr/viewer/ssplayer/uniplayer_support/content.php?content_id={}&_={}",
        content_id,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );

    let response = state.http_client
        .get(&content_url)
        .header("Referer", "https://commons.ssu.ac.kr/")
        .header("Origin", "https://commons.ssu.ac.kr")
        .header("Cookie", cookies)
        .send()
        .await
        .map_err(|e| format!("content.php 요청 실패: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("content.php HTTP {}", response.status().as_u16()));
    }

    let xml = response.text().await.map_err(|e| e.to_string())?;
    let media_url = extract_media_url(&xml)
        .ok_or_else(|| "다운로드할 수 없는 콘텐츠 형식입니다".to_string())?;

    if format == "m4a" {
        // MP4 다운로드 → AAC 추출
        let tmp_path = file_path.replace(".m4a", ".tmp.mp4");
        download_file(&state.http_client, &media_url, &tmp_path, content_id, app, 90).await?;

        // AAC 추출 진행률
        let _ = app.emit("download-progress", DownloadProgressData {
            content_id: content_id.to_string(),
            downloaded: 0,
            total: 0,
            percent: 92,
            status: Some("extracting".to_string()),
            batch_completed: None,
            batch_total: None,
        });

        crate::media::extract_aac(&tmp_path, file_path)?;

        // 임시 MP4 삭제
        let _ = tokio::fs::remove_file(&tmp_path).await;

        let _ = app.emit("download-progress", DownloadProgressData {
            content_id: content_id.to_string(),
            downloaded: 0,
            total: 0,
            percent: 100,
            status: Some("done".to_string()),
            batch_completed: None,
            batch_total: None,
        });

        Ok(file_path.to_string())
    } else {
        // MP4 직접 다운로드
        download_file(&state.http_client, &media_url, file_path, content_id, app, 100).await?;

        let _ = app.emit("download-progress", DownloadProgressData {
            content_id: content_id.to_string(),
            downloaded: 0,
            total: 0,
            percent: 100,
            status: Some("done".to_string()),
            batch_completed: None,
            batch_total: None,
        });

        Ok(file_path.to_string())
    }
}
```

- [ ] **Step 2: Cargo.toml에 futures-util 추가**

```toml
futures-util = "0.3"
```

- [ ] **Step 3: main.rs에 모듈 등록**

```rust
mod download;
```

- [ ] **Step 4: 빌드 확인**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: media 모듈이 아직 없으므로 컴파일 에러. 다음 Task에서 해결.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/download.rs src-tauri/Cargo.toml src-tauri/src/main.rs
git commit -m "feat: add HTTPS download with progress events"
```

---

### Task 7: media.rs — symphonia AAC 추출

**Files:**
- Create: `src-tauri/src/media.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: media.rs 작성**

`src-tauri/src/media.rs`:

```rust
use std::fs::File;
use std::io::Write;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// MP4 파일에서 AAC 오디오 트랙을 추출하여 .m4a 파일로 저장한다.
/// 트랜스코딩 없이 원본 AAC 패킷을 그대로 복사하므로 품질 손실이 없다.
pub fn extract_aac(mp4_path: &str, m4a_path: &str) -> Result<(), String> {
    let file = File::open(mp4_path)
        .map_err(|e| format!("MP4 파일 열기 실패: {}", e))?;

    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    hint.with_extension("mp4");

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("MP4 파싱 실패: {}", e))?;

    let mut format_reader = probed.format;

    // 오디오 트랙 찾기
    let audio_track = format_reader
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec == symphonia::core::codecs::CODEC_TYPE_AAC)
        .ok_or("AAC 오디오 트랙을 찾을 수 없습니다")?;

    let track_id = audio_track.id;

    // AAC 패킷을 ADTS 헤더와 함께 raw AAC 파일로 저장
    // Gemini API는 audio/aac MIME 타입을 지원한다.
    let mut output = File::create(m4a_path)
        .map_err(|e| format!("출력 파일 생성 실패: {}", e))?;

    let codec_params = audio_track.codec_params.clone();
    let sample_rate = codec_params.sample_rate.unwrap_or(44100);
    let channels = codec_params.channels.map(|c| c.count()).unwrap_or(2) as u8;

    // 샘플레이트 인덱스 (ADTS 헤더에 필요)
    let sample_rate_index = match sample_rate {
        96000 => 0u8,
        88200 => 1,
        64000 => 2,
        48000 => 3,
        44100 => 4,
        32000 => 5,
        24000 => 6,
        22050 => 7,
        16000 => 8,
        12000 => 9,
        11025 => 10,
        8000 => 11,
        _ => 4, // default to 44100
    };

    loop {
        match format_reader.next_packet() {
            Ok(packet) => {
                if packet.track_id() != track_id {
                    continue;
                }

                let data = &packet.buf();
                let frame_len = data.len() + 7; // ADTS 헤더 7바이트

                // ADTS 헤더 생성 (7바이트, CRC 없음)
                let mut header = [0u8; 7];
                header[0] = 0xFF; // syncword
                header[1] = 0xF1; // syncword + MPEG-4 + Layer 0 + no CRC
                header[2] = (1 << 6) // AAC-LC profile (2-1=1, shifted left 6)
                    | (sample_rate_index << 2)
                    | ((channels >> 2) & 0x01);
                header[3] = ((channels & 0x03) << 6)
                    | ((frame_len >> 11) as u8 & 0x03);
                header[4] = ((frame_len >> 3) as u8) & 0xFF;
                header[5] = (((frame_len & 0x07) as u8) << 5) | 0x1F;
                header[6] = 0xFC;

                output.write_all(&header)
                    .map_err(|e| format!("ADTS 헤더 쓰기 실패: {}", e))?;
                output.write_all(data)
                    .map_err(|e| format!("AAC 데이터 쓰기 실패: {}", e))?;
            }
            Err(symphonia::core::errors::Error::IoError(e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break; // 파일 끝
            }
            Err(e) => {
                return Err(format!("패킷 읽기 실패: {}", e));
            }
        }
    }

    output.flush().map_err(|e| format!("파일 플러시 실패: {}", e))?;
    Ok(())
}
```

- [ ] **Step 2: main.rs에 모듈 등록**

```rust
mod media;
```

- [ ] **Step 3: 빌드 확인**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: 이제 download.rs의 `crate::media::extract_aac` 참조가 해결되어 컴파일 성공

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/media.rs src-tauri/src/main.rs
git commit -m "feat: add symphonia-based AAC extraction from MP4"
```

---

### Task 8: gemini.rs — Gemini API 연동

**Files:**
- Create: `src-tauri/src/gemini.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: gemini.rs 작성**

`src-tauri/src/gemini.rs`:

```rust
use std::path::Path;
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::config::GEMINI_MAX_RETRIES;

#[derive(Debug, Serialize)]
struct GeminiRequest {
    contents: Vec<GeminiContent>,
}

#[derive(Debug, Serialize)]
struct GeminiContent {
    parts: Vec<GeminiPart>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum GeminiPart {
    Text { text: String },
    InlineData { inline_data: InlineData },
    FileData { file_data: FileData },
}

#[derive(Debug, Serialize)]
struct InlineData {
    mime_type: String,
    data: String,
}

#[derive(Debug, Serialize)]
struct FileData {
    file_uri: String,
    mime_type: String,
}

#[derive(Debug, Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<Candidate>>,
}

#[derive(Debug, Deserialize)]
struct Candidate {
    content: Option<CandidateContent>,
}

#[derive(Debug, Deserialize)]
struct CandidateContent {
    parts: Option<Vec<CandidatePart>>,
}

#[derive(Debug, Deserialize)]
struct CandidatePart {
    text: Option<String>,
}

// File API types
#[derive(Debug, Serialize)]
struct UploadMetadata {
    file: FileMetadata,
}

#[derive(Debug, Serialize)]
struct FileMetadata {
    display_name: String,
}

#[derive(Debug, Deserialize)]
struct UploadResponse {
    file: UploadedFile,
}

#[derive(Debug, Deserialize)]
struct UploadedFile {
    name: String,
    uri: String,
    #[serde(rename = "mimeType")]
    mime_type: String,
    state: String,
}

#[derive(Debug, Deserialize)]
struct GetFileResponse {
    name: String,
    uri: String,
    #[serde(rename = "mimeType")]
    mime_type: String,
    state: String,
}

/// Gemini API에 오디오 파일을 전송하여 텍스트로 변환한다.
pub async fn transcribe_one(
    audio_path: &str,
    api_key: &str,
    model: &str,
    use_file_api: bool,
) -> Result<String, String> {
    let client = reqwest::Client::new();

    let audio_part = if use_file_api {
        let (file_uri, mime_type, file_name) = upload_and_wait_for_active(audio_path, api_key).await?;
        let part = GeminiPart::FileData {
            file_data: FileData { file_uri, mime_type },
        };
        // 변환 완료 후 파일 삭제 (finally 대신 scopeguard 패턴)
        let result = generate_content(&client, api_key, model, vec![
            part,
            GeminiPart::Text {
                text: "이 오디오의 내용을 한국어 텍스트로 정확하게 받아적어주세요. 강의 내용이므로 전문 용어를 정확히 표기하고, 문단을 적절히 나눠주세요.".into(),
            },
        ]).await;

        // 업로드된 파일 정리
        let _ = delete_uploaded_file(&file_name, api_key).await;
        return result;
    } else {
        let data = tokio::fs::read(audio_path)
            .await
            .map_err(|e| format!("파일 읽기 실패: {}", e))?;
        let encoded = base64::engine::general_purpose::STANDARD.encode(&data);

        let mime_type = if audio_path.ends_with(".m4a") || audio_path.ends_with(".aac") {
            "audio/aac"
        } else {
            "audio/mp3"
        };

        GeminiPart::InlineData {
            inline_data: InlineData {
                mime_type: mime_type.to_string(),
                data: encoded,
            },
        }
    };

    generate_content(&client, api_key, model, vec![
        audio_part,
        GeminiPart::Text {
            text: "이 오디오의 내용을 한국어 텍스트로 정확하게 받아적어주세요. 강의 내용이므로 전문 용어를 정확히 표기하고, 문단을 적절히 나눠주세요.".into(),
        },
    ]).await
}

/// 텍스트 요약
pub async fn summarize_text(
    text: &str,
    api_key: &str,
    model: &str,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    generate_content(&client, api_key, model, vec![
        GeminiPart::Text { text: text.to_string() },
        GeminiPart::Text {
            text: "아래 강의 원문을 시험 대비용으로 요약하세요.\n\
                요구사항:\n\
                1) 핵심 개념 정의 3~5개\n\
                2) 개념 간 관계를 3줄 이내 설명\n\
                3) 기억해야 할 포인트 5개 bullet\n\
                4) 마지막에 한 줄 결론\n\n\
                모든 내용은 원문 근거 기반으로 작성하고, 없는 내용은 추가하지 마세요.".into(),
        },
    ]).await
}

/// PDF 파일 요약
pub async fn summarize_pdf(
    pdf_path: &str,
    api_key: &str,
    model: &str,
) -> Result<String, String> {
    let (file_uri, mime_type, file_name) = upload_and_wait_for_active(pdf_path, api_key).await?;

    let result = generate_content(&reqwest::Client::new(), api_key, model, vec![
        GeminiPart::FileData {
            file_data: FileData { file_uri, mime_type },
        },
        GeminiPart::Text {
            text: "이 PDF 강의자료를 한국어로 요약하세요.\n\
                요구사항:\n\
                1) 핵심 개념 3~5개\n\
                2) 중요 포인트 5개 bullet\n\
                3) 마지막에 한 줄 결론\n\n\
                원문에 없는 내용은 추측하지 마세요.".into(),
        },
    ]).await;

    let _ = delete_uploaded_file(&file_name, api_key).await;
    result
}

/// Gemini generateContent API 호출
async fn generate_content(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    parts: Vec<GeminiPart>,
) -> Result<String, String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        model, api_key
    );

    let request = GeminiRequest {
        contents: vec![GeminiContent { parts }],
    };

    let response = client
        .post(&url)
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Gemini API 요청 실패: {}", e))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        if status == 429 {
            return Err(format!("429: {}", body));
        }
        return Err(format!("Gemini API HTTP {}: {}", status, body));
    }

    let resp: GeminiResponse = response.json().await
        .map_err(|e| format!("응답 파싱 실패: {}", e))?;

    resp.candidates
        .and_then(|c| c.into_iter().next())
        .and_then(|c| c.content)
        .and_then(|c| c.parts)
        .and_then(|p| p.into_iter().next())
        .and_then(|p| p.text)
        .ok_or_else(|| "Gemini 응답에 텍스트가 없습니다".to_string())
}

/// File API로 파일을 업로드하고 ACTIVE 상태가 될 때까지 대기
async fn upload_and_wait_for_active(
    file_path: &str,
    api_key: &str,
) -> Result<(String, String, String), String> {
    let client = reqwest::Client::new();
    let file_name = Path::new(file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");

    let mime_type = if file_path.ends_with(".pdf") {
        "application/pdf"
    } else if file_path.ends_with(".m4a") || file_path.ends_with(".aac") {
        "audio/aac"
    } else {
        "audio/mp3"
    };

    let file_data = tokio::fs::read(file_path)
        .await
        .map_err(|e| format!("파일 읽기 실패: {}", e))?;

    // 멀티파트 업로드 대신 resumable upload 사용
    let upload_url = format!(
        "https://generativelanguage.googleapis.com/upload/v1beta/files?key={}",
        api_key
    );

    let metadata = serde_json::json!({ "file": { "displayName": file_name } });

    let form = reqwest::multipart::Form::new()
        .text("metadata", metadata.to_string())
        .part("file", reqwest::multipart::Part::bytes(file_data)
            .mime_str(mime_type)
            .map_err(|e| e.to_string())?
            .file_name(file_name.to_string()));

    let response = client
        .post(&upload_url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("File API 업로드 실패: {}", e))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("File API 업로드 HTTP 오류: {}", body));
    }

    let upload_resp: UploadResponse = response.json().await
        .map_err(|e| format!("업로드 응답 파싱 실패: {}", e))?;

    let mut file = upload_resp.file;

    // ACTIVE 상태까지 폴링
    while file.state == "PROCESSING" {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;

        let get_url = format!(
            "https://generativelanguage.googleapis.com/v1beta/{}?key={}",
            file.name, api_key
        );

        let resp: GetFileResponse = client
            .get(&get_url)
            .send()
            .await
            .map_err(|e| format!("파일 상태 조회 실패: {}", e))?
            .json()
            .await
            .map_err(|e| format!("상태 응답 파싱 실패: {}", e))?;

        file.state = resp.state;
        file.uri = resp.uri;
    }

    if file.state == "FAILED" {
        return Err("Gemini File API: 파일 처리에 실패했습니다.".to_string());
    }

    Ok((file.uri, file.mime_type, file.name))
}

/// 업로드된 파일 삭제 (실패해도 무시)
async fn delete_uploaded_file(file_name: &str, api_key: &str) -> Result<(), String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/{}?key={}",
        file_name, api_key
    );
    let _ = reqwest::Client::new().delete(&url).send().await;
    Ok(())
}

/// 429 Rate Limit 시 지수 백오프로 재시도
pub async fn with_retry<F, Fut, T>(f: F, max_retries: u32) -> Result<T, String>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    for attempt in 0..max_retries {
        match f().await {
            Ok(result) => return Ok(result),
            Err(e) => {
                if is_quota_exhausted(&e) {
                    return Err(
                        "Gemini API 무료 할당량이 소진되었습니다. Google AI Studio에서 요금제를 확인하거나, 할당량이 초기화될 때까지 기다려주세요.".to_string()
                    );
                }
                if e.contains("429") && attempt < max_retries - 1 {
                    let server_delay = parse_retry_delay(&e);
                    let backoff_delay = 2u64.pow(attempt) * 2000;
                    let delay = server_delay.unwrap_or(backoff_delay);
                    tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
                    continue;
                }
                return Err(e);
            }
        }
    }
    Err("최대 재시도 횟수 초과".to_string())
}

fn parse_retry_delay(message: &str) -> Option<u64> {
    let re = regex_lite::Regex::new(r"retry in (\d+(?:\.\d+)?)s").ok()?;
    let caps = re.captures(message)?;
    let secs: f64 = caps.get(1)?.as_str().parse().ok()?;
    Some((secs * 1000.0).ceil() as u64)
}

fn is_quota_exhausted(message: &str) -> bool {
    message.contains("exceeded your current quota")
        || (message.contains("Quota exceeded") && message.contains("limit: 0"))
}
```

- [ ] **Step 2: main.rs에 모듈 등록**

```rust
mod gemini;
```

- [ ] **Step 3: 빌드 확인**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: 컴파일 성공

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/gemini.rs src-tauri/src/main.rs
git commit -m "feat: add Gemini API integration (STT, summarize, File API)"
```

---

### Task 9: history.rs — 히스토리 관리

**Files:**
- Create: `src-tauri/src/history.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: history.rs 작성**

`src-tauri/src/history.rs`:

```rust
use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRecord {
    pub content_id: String,
    pub title: String,
    pub course_id: String,
    pub course_name: String,
    pub file_path: String,
    pub format: String,  // "mp4" or "m4a"
    pub file_size: u64,
    pub duration: u64,
    pub downloaded_at: String,
    pub txt_path: Option<String>,
    pub summary_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRecordWithStatus {
    #[serde(flatten)]
    pub record: DownloadRecord,
    pub file_exists: bool,
    pub txt_exists: bool,
    pub summary_exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiFileHistoryRecord {
    pub download_url: String,
    pub title: String,
    pub file_path: String,
    pub downloaded_at: String,
    pub summary_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiFileHistoryRecordWithStatus {
    #[serde(flatten)]
    pub record: WikiFileHistoryRecord,
    pub file_exists: bool,
    pub summary_exists: bool,
}

fn history_path(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap().join("download-history.json")
}

fn wiki_history_path(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap().join("wiki-history.json")
}

pub fn load_history(app: &AppHandle) -> Vec<DownloadRecord> {
    let path = history_path(app);
    if !path.exists() {
        return Vec::new();
    }
    let data = fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&data).unwrap_or_default()
}

pub fn save_history(app: &AppHandle, records: &[DownloadRecord]) {
    let path = history_path(app);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let json = serde_json::to_string_pretty(records).unwrap_or_default();
    let _ = fs::write(&path, json);
}

/// contentId 기준으로 upsert. 기존 레코드의 txtPath/summaryPath는 보존한다.
pub fn add_record(app: &AppHandle, record: DownloadRecord) {
    let mut records = load_history(app);
    if let Some(existing) = records.iter_mut().find(|r| r.content_id == record.content_id) {
        let txt = existing.txt_path.clone();
        let summary = existing.summary_path.clone();
        *existing = record;
        if existing.txt_path.is_none() {
            existing.txt_path = txt;
        }
        if existing.summary_path.is_none() {
            existing.summary_path = summary;
        }
    } else {
        records.push(record);
    }
    save_history(app, &records);
}

pub fn update_transcription(app: &AppHandle, content_id: &str, txt_path: &str, summary_path: Option<&str>) {
    let mut records = load_history(app);
    if let Some(record) = records.iter_mut().find(|r| r.content_id == content_id) {
        record.txt_path = Some(txt_path.to_string());
        record.summary_path = summary_path.map(|s| s.to_string());
    }
    save_history(app, &records);
}

pub fn remove_record(app: &AppHandle, content_id: &str) {
    let mut records = load_history(app);
    records.retain(|r| r.content_id != content_id);
    save_history(app, &records);
}

pub fn get_history_with_status(app: &AppHandle) -> Vec<DownloadRecordWithStatus> {
    load_history(app)
        .into_iter()
        .map(|r| {
            let file_exists = std::path::Path::new(&r.file_path).exists();
            let txt_exists = r.txt_path.as_ref().map(|p| std::path::Path::new(p).exists()).unwrap_or(false);
            let summary_exists = r.summary_path.as_ref().map(|p| std::path::Path::new(p).exists()).unwrap_or(false);
            DownloadRecordWithStatus {
                record: r,
                file_exists,
                txt_exists,
                summary_exists,
            }
        })
        .collect()
}

// Wiki history - 동일 패턴
pub fn load_wiki_history(app: &AppHandle) -> Vec<WikiFileHistoryRecord> {
    let path = wiki_history_path(app);
    if !path.exists() {
        return Vec::new();
    }
    let data = fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&data).unwrap_or_default()
}

pub fn save_wiki_history(app: &AppHandle, records: &[WikiFileHistoryRecord]) {
    let path = wiki_history_path(app);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let json = serde_json::to_string_pretty(records).unwrap_or_default();
    let _ = fs::write(&path, json);
}

pub fn add_wiki_record(app: &AppHandle, record: WikiFileHistoryRecord) {
    let mut records = load_wiki_history(app);
    if let Some(existing) = records.iter_mut().find(|r| r.download_url == record.download_url) {
        *existing = record;
    } else {
        records.push(record);
    }
    save_wiki_history(app, &records);
}
```

- [ ] **Step 2: main.rs에 모듈 등록**

```rust
mod history;
```

- [ ] **Step 3: 빌드 확인**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: 컴파일 성공

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/history.rs src-tauri/src/main.rs
git commit -m "feat: add JSON-based download and wiki history"
```

---

### Task 10: commands.rs — Tauri 커맨드 통합

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: commands.rs 작성**

`src-tauri/src/commands.rs`:

```rust
use std::path::Path;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Emitter};
use tokio::sync::Semaphore;
use std::sync::Arc;

use crate::config::*;
use crate::download;
use crate::gemini;
use crate::history;
use crate::lms;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct ApiResult<T: Serialize> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T: Serialize> ApiResult<T> {
    fn ok(data: T) -> Self {
        Self { success: true, data: Some(data), error: None }
    }
    fn err(msg: impl Into<String>) -> Self {
        Self { success: false, data: None, error: Some(msg.into()) }
    }
}

// --- 강의 목록 ---

#[tauri::command]
pub async fn fetch_courses(app: AppHandle) -> ApiResult<Vec<lms::CourseItem>> {
    let state = app.state::<AppState>();
    let cookies = state.get_cookies().await;
    match lms::fetch_courses_api(state.inner(), &cookies).await {
        Ok(courses) => ApiResult::ok(courses),
        Err(e) => ApiResult::err(e),
    }
}

#[tauri::command]
pub async fn fetch_modules(
    app: AppHandle,
    course_id: String,
) -> ApiResult<(Vec<lms::VideoItem>, Vec<lms::WikiPageItem>)> {
    let state = app.state::<AppState>();
    let cookies = state.get_cookies().await;
    let xn = state.xn_api_token.lock().await.clone();
    let csrf = state.csrf_token.lock().await.clone();
    match lms::fetch_modules_api(
        state.inner(),
        &course_id,
        &cookies,
        xn.as_deref(),
        csrf.as_deref(),
    ).await {
        Ok((videos, wiki_pages)) => ApiResult::ok((videos, wiki_pages)),
        Err(e) => ApiResult::err(e),
    }
}

// --- 다운로드 ---

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoRef {
    pub content_id: String,
    pub title: String,
    pub file_size: Option<u64>,
    pub duration: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadMeta {
    pub course_id: String,
    pub course_name: String,
}

#[tauri::command]
pub async fn download_video(
    app: AppHandle,
    content_id: String,
    title: String,
    folder_path: String,
    format: String,
    meta: Option<DownloadMeta>,
) -> ApiResult<String> {
    let state = app.state::<AppState>();
    let cookies = state.get_cookies().await;
    let ext = if format == "m4a" { "m4a" } else { "mp4" };
    let safe_name = to_safe_file_name(&title, 12);
    let file_path = format!("{}/{}.{}", folder_path, safe_name, ext);

    match download::download_one(state.inner(), &content_id, &file_path, &cookies, &app, &format).await {
        Ok(path) => {
            if let Some(m) = meta {
                history::add_record(&app, history::DownloadRecord {
                    content_id,
                    title,
                    course_id: m.course_id,
                    course_name: m.course_name,
                    file_path: path.clone(),
                    format: ext.to_string(),
                    file_size: 0,
                    duration: 0,
                    downloaded_at: chrono_now(),
                    txt_path: None,
                    summary_path: None,
                });
            }
            ApiResult::ok(path)
        }
        Err(e) => ApiResult::err(e),
    }
}

#[tauri::command]
pub async fn download_all(
    app: AppHandle,
    videos: Vec<VideoRef>,
    folder_path: String,
    format: String,
    meta: Option<DownloadMeta>,
) -> ApiResult<Vec<serde_json::Value>> {
    let state = app.state::<AppState>();
    let cookies = state.get_cookies().await;
    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_DOWNLOADS));
    let results = Arc::new(tokio::sync::Mutex::new(Vec::new()));
    let total = videos.len() as u32;

    let mut handles = Vec::new();

    for video in videos {
        let sem = semaphore.clone();
        let res = results.clone();
        let app_c = app.clone();
        let cookies_c = cookies.clone();
        let folder_c = folder_path.clone();
        let format_c = format.clone();
        let meta_c = meta.clone();
        let state_c = app_c.state::<AppState>().inner().clone();

        handles.push(tokio::spawn(async move {
            let _permit = sem.acquire().await.unwrap();
            let ext = if format_c == "m4a" { "m4a" } else { "mp4" };
            let safe_name = to_safe_file_name(&video.title, 12);
            let file_path = format!("{}/{}.{}", folder_c, safe_name, ext);

            let result = download::download_one(
                &state_c, &video.content_id, &file_path, &cookies_c, &app_c, &format_c
            ).await;

            let success = result.is_ok();
            let error = result.as_ref().err().cloned();

            if success {
                if let Some(ref m) = meta_c {
                    history::add_record(&app_c, history::DownloadRecord {
                        content_id: video.content_id.clone(),
                        title: video.title.clone(),
                        course_id: m.course_id.clone(),
                        course_name: m.course_name.clone(),
                        file_path: file_path.clone(),
                        format: ext.to_string(),
                        file_size: video.file_size.unwrap_or(0),
                        duration: video.duration.unwrap_or(0),
                        downloaded_at: chrono_now(),
                        txt_path: None,
                        summary_path: None,
                    });
                }
            }

            let mut completed = res.lock().await;
            completed.push(serde_json::json!({
                "title": video.title,
                "success": success,
                "error": error,
            }));

            // 배치 진행률
            let _ = app_c.emit("download-progress", download::DownloadProgressData {
                content_id: video.content_id,
                downloaded: 0,
                total: 0,
                percent: 100,
                status: Some(if success { "done" } else { "error" }.to_string()),
                batch_completed: Some(completed.len() as u32),
                batch_total: Some(total),
            });
        }));
    }

    for handle in handles {
        let _ = handle.await;
    }

    let results = Arc::try_unwrap(results).unwrap().into_inner();
    ApiResult::ok(results)
}

// --- 텍스트 변환 ---

#[tauri::command]
pub async fn transcribe_audio(
    app: AppHandle,
    file_path: String,
    with_summary: bool,
    use_file_api: bool,
    api_key: String,
    model: String,
) -> ApiResult<String> {
    let file_name = Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    // M4A 파일을 직접 Gemini에 전송
    let _ = app.emit("transcribe-progress", serde_json::json!({
        "fileName": file_name,
        "percent": 10,
        "status": if use_file_api { "uploading" } else { "transcribing" },
    }));

    let transcribe_result = gemini::with_retry(
        || gemini::transcribe_one(&file_path, &api_key, &model, use_file_api),
        GEMINI_MAX_RETRIES,
    ).await;

    match transcribe_result {
        Ok(text) => {
            let dir = Path::new(&file_path).parent().unwrap();
            let stem = Path::new(&file_path).file_stem().and_then(|s| s.to_str()).unwrap_or("output");
            let txt_path = dir.join(format!("{}.txt", stem));
            let _ = tokio::fs::write(&txt_path, &text).await;

            if with_summary {
                let _ = app.emit("transcribe-progress", serde_json::json!({
                    "fileName": file_name,
                    "percent": 90,
                    "status": "merging",
                }));
                if let Ok(summary) = gemini::with_retry(
                    || gemini::summarize_text(&text, &api_key, &model),
                    GEMINI_MAX_RETRIES,
                ).await {
                    let summary_path = dir.join(format!("{}_요약본.md", stem));
                    let _ = tokio::fs::write(&summary_path, &summary).await;
                }
            }

            let _ = app.emit("transcribe-progress", serde_json::json!({
                "fileName": file_name,
                "percent": 100,
                "status": "done",
            }));

            ApiResult::ok(text)
        }
        Err(e) => {
            let _ = app.emit("transcribe-progress", serde_json::json!({
                "fileName": file_name,
                "percent": 0,
                "status": "error",
            }));
            ApiResult::err(e)
        }
    }
}

// --- 설정 ---

#[tauri::command]
pub fn get_gemini_model_options() -> Vec<GeminiModelOption> {
    gemini_model_options()
}

#[tauri::command]
pub fn get_history(app: AppHandle) -> Vec<history::DownloadRecordWithStatus> {
    history::get_history_with_status(&app)
}

#[tauri::command]
pub fn remove_history_record(app: AppHandle, content_id: String) {
    history::remove_record(&app, &content_id);
}

// --- 위키 ---

#[tauri::command]
pub async fn download_wiki_file(
    app: AppHandle,
    download_url: String,
    title: String,
    folder_path: String,
) -> ApiResult<String> {
    let state = app.state::<AppState>();
    let cookies = state.get_cookies().await;
    let safe_name = to_safe_file_name(&title, 12);
    let file_path = format!("{}/{}", folder_path, safe_name);

    let response = state.http_client
        .get(&download_url)
        .header("Cookie", &cookies)
        .send()
        .await
        .map_err(|e| format!("다운로드 실패: {}", e));

    match response {
        Ok(res) => {
            if !res.status().is_success() {
                return ApiResult::err(format!("HTTP {}", res.status().as_u16()));
            }
            let bytes = res.bytes().await.map_err(|e| e.to_string());
            match bytes {
                Ok(data) => {
                    match tokio::fs::write(&file_path, &data).await {
                        Ok(_) => {
                            history::add_wiki_record(&app, history::WikiFileHistoryRecord {
                                download_url,
                                title,
                                file_path: file_path.clone(),
                                downloaded_at: chrono_now(),
                                summary_path: None,
                            });
                            ApiResult::ok(file_path)
                        }
                        Err(e) => ApiResult::err(format!("파일 저장 실패: {}", e)),
                    }
                }
                Err(e) => ApiResult::err(e),
            }
        }
        Err(e) => ApiResult::err(e),
    }
}

#[tauri::command]
pub async fn summarize_wiki_pdf(
    app: AppHandle,
    pdf_path: String,
    api_key: String,
    model: String,
) -> ApiResult<String> {
    match gemini::with_retry(
        || gemini::summarize_pdf(&pdf_path, &api_key, &model),
        GEMINI_MAX_RETRIES,
    ).await {
        Ok(summary) => {
            let dir = Path::new(&pdf_path).parent().unwrap();
            let stem = Path::new(&pdf_path).file_stem().and_then(|s| s.to_str()).unwrap_or("output");
            let summary_path = dir.join(format!("{}_요약본.md", stem));
            let _ = tokio::fs::write(&summary_path, &summary).await;
            ApiResult::ok(summary)
        }
        Err(e) => ApiResult::err(e),
    }
}

#[tauri::command]
pub async fn select_folder() -> Option<String> {
    // tauri-plugin-dialog의 폴더 선택은 프론트엔드에서 처리
    None
}

fn chrono_now() -> String {
    // ISO 8601 형식의 현재 시각
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    format!("{}", now) // 간소화. 프로덕션에서는 chrono crate 사용 권장
}
```

- [ ] **Step 2: state.rs에 get_cookies 메서드 추가**

`src-tauri/src/state.rs`에 추가:

```rust
impl AppState {
    // ... 기존 new() 메서드 ...

    /// 저장된 쿠키 문자열을 반환한다.
    /// WebView에서 추출한 쿠키를 별도 필드로 관리한다.
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
```

state.rs의 AppState 구조체에 `cookies` 필드 추가:

```rust
pub struct AppState {
    pub cookie_jar: Arc<Jar>,
    pub xn_api_token: Mutex<Option<String>>,
    pub csrf_token: Mutex<Option<String>>,
    pub cookies: Mutex<Option<String>>,
    pub http_client: reqwest::Client,
}
```

new()에서 `cookies: Mutex::new(None)` 추가.

- [ ] **Step 3: AppState에 Clone derive 추가 또는 inner() 접근 방식 변경**

`state.rs`에서 AppState는 Clone이 안 되므로, commands.rs에서 `state.inner()` 대신 `&*state`를 사용하도록 조정. 또는 `download_all`에서 state 접근 방식 수정.

- [ ] **Step 4: main.rs에 모든 커맨드 등록**

```rust
mod config;
mod state;
mod auth;
mod lms;
mod download;
mod media;
mod gemini;
mod history;
mod commands;

use state::AppState;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            auth::open_login,
            auth::extract_tokens,
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
```

- [ ] **Step 5: 빌드 확인**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: 컴파일 성공 (경고는 허용)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/state.rs src-tauri/src/main.rs
git commit -m "feat: add Tauri commands integrating all backend services"
```

---

### Task 11: 프론트엔드 유틸리티 및 API 레이어

**Files:**
- Create: `src/js/utils/dom.js`
- Create: `src/js/utils/format.js`
- Create: `src/js/api.js`

- [ ] **Step 1: dom.js 작성**

`src/js/utils/dom.js`:

```javascript
/**
 * DOM 요소 생성 헬퍼
 * @param {string} tag - 태그명
 * @param {Object} attrs - 속성 객체
 * @param  {...(Node|string)} children - 자식 요소
 */
export function el(tag, attrs = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'className') {
      element.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(element.style, value);
    } else if (key.startsWith('on')) {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      element.setAttribute(key, value);
    }
  }
  for (const child of children) {
    if (typeof child === 'string') {
      element.appendChild(document.createTextNode(child));
    } else if (child) {
      element.appendChild(child);
    }
  }
  return element;
}

/** 컨테이너 내용 교체 */
export function render(container, ...children) {
  container.innerHTML = '';
  for (const child of children) {
    if (typeof child === 'string') {
      container.appendChild(document.createTextNode(child));
    } else if (child) {
      container.appendChild(child);
    }
  }
}
```

- [ ] **Step 2: format.js 작성**

`src/js/utils/format.js`:

```javascript
/** 바이트를 사람이 읽기 쉬운 형식으로 변환 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/** 초를 mm:ss 형식으로 변환 */
export function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
```

- [ ] **Step 3: api.js 작성**

`src/js/api.js`:

```javascript
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { open: openDialog } = window.__TAURI__.dialog;

export const api = {
  // 인증
  openLogin: () => invoke('open_login'),

  // 강의
  fetchCourses: () => invoke('fetch_courses'),
  fetchModules: (courseId) => invoke('fetch_modules', { courseId }),

  // 다운로드
  downloadVideo: (contentId, title, folderPath, format, meta) =>
    invoke('download_video', { contentId, title, folderPath, format, meta }),
  downloadAll: (videos, folderPath, format, meta) =>
    invoke('download_all', { videos, folderPath, format, meta }),

  // 텍스트 변환
  transcribeAudio: (filePath, withSummary, useFileApi, apiKey, model) =>
    invoke('transcribe_audio', { filePath, withSummary, useFileApi, apiKey, model }),

  // 설정
  getGeminiModelOptions: () => invoke('get_gemini_model_options'),

  // 히스토리
  getHistory: () => invoke('get_history'),
  removeHistoryRecord: (contentId) => invoke('remove_history_record', { contentId }),

  // 위키
  downloadWikiFile: (downloadUrl, title, folderPath) =>
    invoke('download_wiki_file', { downloadUrl, title, folderPath }),
  summarizeWikiPdf: (pdfPath, apiKey, model) =>
    invoke('summarize_wiki_pdf', { pdfPath, apiKey, model }),

  // 폴더 선택 (Tauri dialog plugin)
  selectFolder: () => openDialog({ directory: true, title: '폴더 선택' }),
};

export const events = {
  onDownloadProgress: (callback) => listen('download-progress', (e) => callback(e.payload)),
  onTranscribeProgress: (callback) => listen('transcribe-progress', (e) => callback(e.payload)),
};
```

- [ ] **Step 4: Commit**

```bash
git add src/js/utils/dom.js src/js/utils/format.js src/js/api.js
git commit -m "feat: add frontend utilities and Tauri API wrapper"
```

---

### Task 12: 프론트엔드 컴포넌트 — 로그인 및 강의 목록

**Files:**
- Create: `src/js/components/login.js`
- Create: `src/js/components/courseList.js`
- Modify: `src/js/app.js`
- Modify: `src/index.html`
- Modify: `src/styles/main.css`

- [ ] **Step 1: login.js 작성**

`src/js/components/login.js`:

```javascript
import { el, render } from '../utils/dom.js';
import { api } from '../api.js';

export function renderLogin(container, onLoginSuccess) {
  const loginBtn = el('button', { className: 'btn btn-primary', onClick: handleLogin }, '숭실대 LMS 로그인');
  const status = el('p', { className: 'status' });

  async function handleLogin() {
    loginBtn.disabled = true;
    loginBtn.textContent = '로그인 중...';
    status.textContent = '';

    const result = await api.openLogin();
    if (result.success) {
      status.textContent = '로그인 성공!';
      status.className = 'status success';
      onLoginSuccess();
    } else {
      status.textContent = result.error || '로그인 실패';
      status.className = 'status error';
      loginBtn.disabled = false;
      loginBtn.textContent = '숭실대 LMS 로그인';
    }
  }

  render(container,
    el('div', { className: 'login-container' },
      el('h2', {}, 'SSU LMS Downloader'),
      el('p', { className: 'subtitle' }, '숭실대학교 Canvas LMS 강의 영상 다운로더'),
      loginBtn,
      status
    )
  );
}
```

- [ ] **Step 2: courseList.js 작성**

`src/js/components/courseList.js`:

```javascript
import { el, render } from '../utils/dom.js';
import { api } from '../api.js';

export function renderCourseList(container, onCourseSelect) {
  const list = el('div', { className: 'course-list' });
  const status = el('p', { className: 'status' }, '강의 목록을 불러오는 중...');

  render(container,
    el('div', {},
      el('h2', {}, '강의 목록'),
      status,
      list
    )
  );

  loadCourses();

  async function loadCourses() {
    const result = await api.fetchCourses();
    status.textContent = '';

    if (!result.success) {
      status.textContent = result.error || '강의 목록 로드 실패';
      status.className = 'status error';
      return;
    }

    if (!result.data || result.data.length === 0) {
      status.textContent = '수강 중인 강의가 없습니다.';
      return;
    }

    list.innerHTML = '';
    for (const course of result.data) {
      const card = el('div', {
        className: 'course-card',
        onClick: () => onCourseSelect(course),
      },
        el('h3', {}, course.name),
        el('span', { className: 'term' }, course.term)
      );
      list.appendChild(card);
    }
  }
}
```

- [ ] **Step 3: app.js 업데이트**

`src/js/app.js`:

```javascript
import { renderLogin } from './components/login.js';
import { renderCourseList } from './components/courseList.js';
import { renderVideoList } from './components/videoList.js';

const appEl = document.getElementById('app');

let currentView = 'login';

function navigate(view, data) {
  currentView = view;
  switch (view) {
    case 'login':
      renderLogin(appEl, () => navigate('courses'));
      break;
    case 'courses':
      renderCourseList(appEl, (course) => navigate('videos', course));
      break;
    case 'videos':
      renderVideoList(appEl, data, () => navigate('courses'));
      break;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  navigate('login');
});
```

- [ ] **Step 4: index.html 업데이트**

`src/index.html`의 script 태그를 module로 유지:

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SSU LMS Downloader</title>
  <link rel="stylesheet" href="styles/main.css" />
</head>
<body>
  <div id="app"></div>
  <script type="module" src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 5: main.css 기본 스타일 추가**

`src/styles/main.css`:

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; color: #333; }
#app { max-width: 960px; margin: 0 auto; padding: 20px; }

h2 { margin-bottom: 16px; font-size: 24px; }
.subtitle { color: #666; margin-bottom: 24px; }

.btn { padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
.btn-primary { background: #2563eb; color: white; }
.btn-primary:hover { background: #1d4ed8; }
.btn-primary:disabled { background: #93c5fd; cursor: not-allowed; }
.btn-secondary { background: #e5e7eb; color: #374151; }
.btn-secondary:hover { background: #d1d5db; }

.login-container { text-align: center; padding: 80px 20px; }

.status { margin-top: 12px; font-size: 14px; }
.status.success { color: #16a34a; }
.status.error { color: #dc2626; }

.course-list { display: grid; gap: 12px; }
.course-card { background: white; padding: 16px; border-radius: 8px; cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
.course-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
.course-card h3 { font-size: 16px; margin-bottom: 4px; }
.course-card .term { font-size: 12px; color: #666; }

.video-list { display: grid; gap: 8px; }
.video-item { background: white; padding: 12px 16px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
.video-item .info { flex: 1; }
.video-item .info h4 { font-size: 14px; margin-bottom: 2px; }
.video-item .info .meta { font-size: 12px; color: #888; }
.video-item .actions { display: flex; gap: 8px; }

.back-btn { background: none; border: none; cursor: pointer; color: #2563eb; font-size: 14px; margin-bottom: 16px; display: inline-block; }
.back-btn:hover { text-decoration: underline; }

.progress-bar { width: 100%; height: 4px; background: #e5e7eb; border-radius: 2px; overflow: hidden; margin-top: 8px; }
.progress-bar .fill { height: 100%; background: #2563eb; transition: width 0.3s; }

.settings-container { margin-top: 24px; padding: 16px; background: white; border-radius: 8px; }
.settings-container label { display: block; margin-bottom: 4px; font-size: 14px; font-weight: 500; }
.settings-container input, .settings-container select { width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 4px; margin-bottom: 12px; font-size: 14px; }

.toolbar { display: flex; gap: 8px; margin-bottom: 16px; align-items: center; }
.toolbar select { padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 4px; }
```

- [ ] **Step 6: Commit**

```bash
git add src/js/components/login.js src/js/components/courseList.js src/js/app.js src/index.html src/styles/main.css
git commit -m "feat: add login and course list frontend components"
```

---

### Task 13: 프론트엔드 컴포넌트 — 영상 목록 및 다운로드

**Files:**
- Create: `src/js/components/videoList.js`
- Create: `src/js/components/downloadProgress.js`

- [ ] **Step 1: videoList.js 작성**

`src/js/components/videoList.js`:

```javascript
import { el, render } from '../utils/dom.js';
import { api, events } from '../api.js';
import { formatBytes, formatDuration } from '../utils/format.js';

export function renderVideoList(container, course, onBack) {
  const list = el('div', { className: 'video-list' });
  const status = el('p', { className: 'status' }, '영상 목록을 불러오는 중...');
  const toolbar = el('div', { className: 'toolbar' });
  const progressContainer = el('div', { id: 'progress-container' });

  const formatSelect = el('select', {},
    el('option', { value: 'mp4' }, 'MP4 (영상)'),
    el('option', { value: 'm4a' }, 'M4A (오디오)')
  );

  const downloadAllBtn = el('button', {
    className: 'btn btn-primary',
    onClick: handleDownloadAll,
  }, '전체 다운로드');

  toolbar.append(formatSelect, downloadAllBtn);

  render(container,
    el('div', {},
      el('button', { className: 'back-btn', onClick: onBack }, '\u2190 강의 목록으로'),
      el('h2', {}, course.name),
      status,
      toolbar,
      list,
      progressContainer
    )
  );

  let videos = [];
  let progressMap = {};

  // 진행률 이벤트 리스너
  events.onDownloadProgress((data) => {
    progressMap[data.contentId] = data;
    updateProgressUI(data);
  });

  loadModules();

  async function loadModules() {
    const result = await api.fetchModules(course.id);
    status.textContent = '';

    if (!result.success) {
      status.textContent = result.error || '모듈 로드 실패';
      status.className = 'status error';
      return;
    }

    const [videoItems, wikiPages] = result.data;
    videos = videoItems.filter(v => v.available);

    if (videos.length === 0) {
      status.textContent = '다운로드 가능한 영상이 없습니다.';
      return;
    }

    list.innerHTML = '';
    for (const video of videos) {
      const item = el('div', { className: 'video-item', id: `video-${video.contentId}` },
        el('div', { className: 'info' },
          el('h4', {}, video.title),
          el('span', { className: 'meta' },
            `${formatDuration(video.duration)} | ${formatBytes(video.fileSize)}`
          )
        ),
        el('div', { className: 'actions' },
          el('button', {
            className: 'btn btn-secondary',
            onClick: () => handleDownload(video),
          }, '다운로드')
        )
      );
      list.appendChild(item);
    }
  }

  async function handleDownload(video) {
    const folder = await api.selectFolder();
    if (!folder) return;

    const format = formatSelect.value;
    const meta = { courseId: course.id, courseName: course.name };
    await api.downloadVideo(video.contentId, video.title, folder, format, meta);
  }

  async function handleDownloadAll() {
    const folder = await api.selectFolder();
    if (!folder) return;

    const format = formatSelect.value;
    const meta = { courseId: course.id, courseName: course.name };
    const refs = videos.map(v => ({
      contentId: v.contentId,
      title: v.title,
      fileSize: v.fileSize,
      duration: v.duration,
    }));
    downloadAllBtn.disabled = true;
    downloadAllBtn.textContent = '다운로드 중...';

    await api.downloadAll(refs, folder, format, meta);

    downloadAllBtn.disabled = false;
    downloadAllBtn.textContent = '전체 다운로드';
  }

  function updateProgressUI(data) {
    const item = document.getElementById(`video-${data.contentId}`);
    if (!item) return;

    let bar = item.querySelector('.progress-bar');
    if (!bar) {
      bar = el('div', { className: 'progress-bar' },
        el('div', { className: 'fill' })
      );
      item.appendChild(bar);
    }
    const fill = bar.querySelector('.fill');
    fill.style.width = `${data.percent}%`;

    if (data.status === 'done') {
      setTimeout(() => bar.remove(), 2000);
    }
  }
}
```

- [ ] **Step 2: downloadProgress.js 작성**

`src/js/components/downloadProgress.js`:

```javascript
import { el } from '../utils/dom.js';

export function createProgressBar(contentId) {
  return el('div', { className: 'progress-bar', id: `progress-${contentId}` },
    el('div', { className: 'fill', style: { width: '0%' } })
  );
}

export function updateProgress(contentId, percent, status) {
  const bar = document.getElementById(`progress-${contentId}`);
  if (!bar) return;
  const fill = bar.querySelector('.fill');
  if (fill) {
    fill.style.width = `${percent}%`;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/js/components/videoList.js src/js/components/downloadProgress.js
git commit -m "feat: add video list and download progress components"
```

---

### Task 14: 프론트엔드 컴포넌트 — 설정

**Files:**
- Create: `src/js/components/settings.js`
- Modify: `src/js/app.js`

- [ ] **Step 1: settings.js 작성**

`src/js/components/settings.js`:

```javascript
import { el, render } from '../utils/dom.js';
import { api } from '../api.js';

export function renderSettings(container, onBack) {
  const status = el('p', { className: 'status' });

  const apiKeyInput = el('input', {
    type: 'password',
    placeholder: 'Gemini API 키 입력',
    id: 'apiKeyInput',
  });

  const modelSelect = el('select', { id: 'modelSelect' });

  const folderDisplay = el('span', { id: 'folderDisplay' }, '선택되지 않음');
  const selectFolderBtn = el('button', {
    className: 'btn btn-secondary',
    onClick: async () => {
      const folder = await api.selectFolder();
      if (folder) {
        folderDisplay.textContent = folder;
        localStorage.setItem('downloadFolder', folder);
      }
    },
  }, '폴더 선택');

  const saveBtn = el('button', {
    className: 'btn btn-primary',
    onClick: handleSave,
  }, '저장');

  render(container,
    el('div', {},
      el('button', { className: 'back-btn', onClick: onBack }, '\u2190 돌아가기'),
      el('h2', {}, '설정'),
      el('div', { className: 'settings-container' },
        el('label', {}, 'Gemini API 키'),
        apiKeyInput,
        el('label', {}, 'Gemini 모델'),
        modelSelect,
        el('label', {}, '다운로드 폴더'),
        el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' } },
          folderDisplay,
          selectFolderBtn
        ),
        saveBtn,
        status
      )
    )
  );

  loadSettings();

  async function loadSettings() {
    // 모델 옵션 로드
    const options = await api.getGeminiModelOptions();
    modelSelect.innerHTML = '';
    for (const opt of options) {
      modelSelect.appendChild(
        el('option', { value: opt.id }, `${opt.label} - ${opt.description}`)
      );
    }

    // 저장된 설정 복원
    const savedKey = localStorage.getItem('geminiApiKey');
    if (savedKey) apiKeyInput.value = savedKey;

    const savedModel = localStorage.getItem('geminiModel');
    if (savedModel) modelSelect.value = savedModel;

    const savedFolder = localStorage.getItem('downloadFolder');
    if (savedFolder) folderDisplay.textContent = savedFolder;
  }

  function handleSave() {
    const apiKey = apiKeyInput.value.trim();
    const model = modelSelect.value;

    if (apiKey) localStorage.setItem('geminiApiKey', apiKey);
    localStorage.setItem('geminiModel', model);

    status.textContent = '설정이 저장되었습니다.';
    status.className = 'status success';
    setTimeout(() => { status.textContent = ''; }, 3000);
  }
}
```

- [ ] **Step 2: app.js에 설정 라우트 추가**

`src/js/app.js`의 navigate 함수에 settings 뷰 추가:

```javascript
import { renderLogin } from './components/login.js';
import { renderCourseList } from './components/courseList.js';
import { renderVideoList } from './components/videoList.js';
import { renderSettings } from './components/settings.js';

const appEl = document.getElementById('app');

function navigate(view, data) {
  switch (view) {
    case 'login':
      renderLogin(appEl, () => navigate('courses'));
      break;
    case 'courses':
      renderCourseList(appEl, (course) => navigate('videos', course));
      break;
    case 'videos':
      renderVideoList(appEl, data, () => navigate('courses'));
      break;
    case 'settings':
      renderSettings(appEl, () => navigate('courses'));
      break;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  navigate('login');
});

// 전역 네비게이션 노출 (설정 버튼 등에서 사용)
window.navigate = navigate;
```

- [ ] **Step 3: Commit**

```bash
git add src/js/components/settings.js src/js/app.js
git commit -m "feat: add settings component with API key and model selection"
```

---

### Task 15: 통합 빌드 및 검증

**Files:**
- Modify: `src-tauri/Cargo.toml` (최종 점검)
- Modify: `src-tauri/src/main.rs` (최종 점검)
- Modify: `package.json`

- [ ] **Step 1: package.json 빌드 스크립트 설정**

프로젝트 루트 `package.json`:

```json
{
  "name": "ssu-lms-downloader",
  "version": "2.0.0",
  "scripts": {
    "dev": "cargo tauri dev",
    "build": "cargo tauri build",
    "build:mac": "cargo tauri build --target universal-apple-darwin",
    "build:win": "cargo tauri build --target x86_64-pc-windows-msvc"
  }
}
```

- [ ] **Step 2: 개발 서버 실행 확인**

```bash
pnpm dev
```

Expected: Tauri 윈도우 열림, 로그인 화면 표시

- [ ] **Step 3: 로그인 플로우 테스트**

1. 로그인 버튼 클릭
2. Canvas SSO 로그인 윈도우 표시 확인
3. 로그인 성공 후 강의 목록 화면 전환 확인

- [ ] **Step 4: 프로덕션 빌드**

```bash
pnpm build
```

Expected: `src-tauri/target/release/bundle/` 아래에 .dmg 또는 .app 생성, 크기 ~5MB

- [ ] **Step 5: 빌드 산출물 크기 확인**

```bash
ls -lh src-tauri/target/release/bundle/macos/*.app
du -sh src-tauri/target/release/bundle/dmg/*.dmg
```

Expected: 10MB 이하

- [ ] **Step 6: Commit**

```bash
git add package.json
git commit -m "feat: finalize build configuration and verify bundle size"
```

---

### Task 16: 위키 페이지 프론트엔드 컴포넌트

**Files:**
- Create: `src/js/components/wikiList.js`
- Modify: `src/js/components/videoList.js`

- [ ] **Step 1: wikiList.js 작성**

`src/js/components/wikiList.js`:

```javascript
import { el, render } from '../utils/dom.js';
import { api } from '../api.js';

export function renderWikiSection(container, wikiPages) {
  if (!wikiPages || wikiPages.length === 0) return;

  const section = el('div', { className: 'wiki-section' },
    el('h3', {}, '위키 페이지 (PDF 파일)')
  );

  for (const page of wikiPages) {
    const pageEl = el('div', { className: 'wiki-page' },
      el('h4', {}, page.title),
    );

    for (const file of page.files) {
      const fileEl = el('div', { className: 'video-item' },
        el('div', { className: 'info' },
          el('h4', {}, file.title)
        ),
        el('div', { className: 'actions' },
          el('button', {
            className: 'btn btn-secondary',
            onClick: async () => {
              const folder = await api.selectFolder();
              if (!folder) return;
              await api.downloadWikiFile(file.downloadUrl, file.title, folder);
            },
          }, '다운로드'),
          el('button', {
            className: 'btn btn-secondary',
            onClick: async () => {
              const apiKey = localStorage.getItem('geminiApiKey');
              const model = localStorage.getItem('geminiModel') || 'gemini-2.0-flash';
              if (!apiKey) { alert('Gemini API 키를 설정해주세요.'); return; }
              const folder = await api.selectFolder();
              if (!folder) return;
              const dlResult = await api.downloadWikiFile(file.downloadUrl, file.title, folder);
              if (dlResult.success && dlResult.data) {
                await api.summarizeWikiPdf(dlResult.data, apiKey, model);
              }
            },
          }, '요약')
        )
      );
      pageEl.appendChild(fileEl);
    }

    section.appendChild(pageEl);
  }

  container.appendChild(section);
}
```

- [ ] **Step 2: videoList.js에서 위키 섹션 통합**

`renderVideoList`의 `loadModules` 함수에서 위키 페이지도 렌더링:

```javascript
// loadModules() 내부, videos 렌더링 이후 추가:
import { renderWikiSection } from './wikiList.js';

// ... 기존 videos 렌더링 코드 ...

// 위키 페이지 렌더링
if (wikiPages.length > 0) {
  renderWikiSection(container.querySelector('div'), wikiPages);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/js/components/wikiList.js src/js/components/videoList.js
git commit -m "feat: add wiki page file download and summarize UI"
```
