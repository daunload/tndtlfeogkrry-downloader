# Soongsil LMS Downloader — Tauri 전환 설계

## 개요

기존 Electron + Vue 3 기반 데스크톱 앱을 **Tauri v2 + 완전 Rust 백엔드 + Vanilla HTML/CSS/JS 프론트엔드**로 전환한다. 목표는 앱 용량을 ~150MB에서 ~5MB로 줄이면서 모든 기능을 유지하는 것이다.

## 전제 조건

- LMS 영상의 오디오 코덱은 모두 AAC라고 가정한다.
- FFmpeg를 사용하지 않는다. symphonia 크레이트로 AAC 추출만 수행한다.
- 자동 업데이트는 지원하지 않는다. GitHub Releases에서 수동 다운로드한다.
- 대상 사용자는 일반 대학생을 포함한다.

## 프로젝트 구조

```
soongsil-lms-downloader-tauri/
├── src-tauri/
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs              # Tauri 앱 진입점, 커맨드 등록
│       ├── auth.rs              # WebView 로그인 → 쿠키 추출 → cookie jar 관리
│       ├── lms.rs               # Canvas API 호출 (강의 목록, 모듈)
│       ├── download.rs          # HTTPS 다운로드 + 진행률 이벤트
│       ├── media.rs             # symphonia로 MP4 → AAC 추출
│       ├── gemini.rs            # Gemini API (STT, 요약)
│       ├── history.rs           # JSON 기반 다운로드/변환 히스토리
│       ├── wiki.rs              # 위키 페이지 파일 다운로드 + PDF 요약
│       └── config.rs            # 설정 상수
├── src/                         # 프론트엔드 (Vanilla)
│   ├── index.html
│   ├── styles/
│   │   └── main.css             # 순수 CSS (Tailwind 미사용)
│   ├── js/
│   │   ├── app.js               # 앱 초기화, 라우팅
│   │   ├── api.js               # Tauri invoke 래퍼
│   │   ├── components/          # DOM 컴포넌트 (렌더 함수)
│   │   │   ├── login.js
│   │   │   ├── courseList.js
│   │   │   ├── videoList.js
│   │   │   ├── wikiList.js
│   │   │   ├── downloadProgress.js
│   │   │   └── settings.js
│   │   └── utils/
│   │       ├── dom.js           # DOM 헬퍼
│   │       └── format.js        # 파일 크기, 시간 포맷
│   └── assets/                  # 아이콘, 이미지
├── tauri.conf.json
└── package.json                 # 빌드 스크립트만 (런타임 의존성 없음)
```

## 인증 및 세션 관리

### 로그인 플로우

1. 사용자가 "로그인" 클릭
2. Tauri 커맨드 → 새 WebView 윈도우로 `canvas.ssu.ac.kr/login` 오픈
3. 사용자가 SSO 로그인 완료
4. URL이 `canvas.ssu.ac.kr/?login_success=1`로 변경 감지
5. WebView에서 JS 실행: `document.cookie` 읽기 + `xn_api_token`, `_csrf_token` 추출
6. Rust로 전달 → `reqwest::cookie::Jar`에 저장
7. 로그인 윈도우 닫기, 메인 UI에 로그인 성공 반영

### Canvas API 호출

로그인 시 추출한 쿠키와 토큰으로 Rust(`reqwest`)에서 직접 Canvas API를 호출한다.

- `GET /api/v1/dashboard/dashboard_cards` → 강의 목록
- `GET /learningx/api/v1/courses/{id}/modules` → 모듈 목록
- `while(1);` CSRF prefix는 Rust에서 문자열 처리로 제거

### 세션 유지

- 쿠키를 `app_data_dir/cookies.json`에 저장하여 앱 재시작 시 재사용
- API 401 응답 시 프론트에 재로그인 요청 이벤트 발송

## 다운로드 및 미디어 파이프라인

### 영상 다운로드

1. Canvas API로 모듈 조회 → 영상 목록 추출
2. `content.php` API 호출 → XML 응답
3. `quick-xml`로 파싱 → 미디어 URL 추출 (기존 4가지 전략 유지)
   - `[MEDIA_FILE]` placeholder 치환
   - 직접 `.mp4` URL 감지
   - desktop HTML5 player path fallback
   - `content_uri` 기반 URL 구성
4. `reqwest`로 MP4 다운로드 (청크 단위, 진행률 이벤트 발송)
5. 동시 다운로드 최대 3개 (`tokio::Semaphore`)

### MP4 → AAC 추출

1. `symphonia`로 MP4 컨테이너 디먹싱
2. AAC 트랙 추출 → `.m4a` 파일 저장 (트랜스코딩 없음, CPU 부하 최소)
3. 19MB 초과 시 분할 대신 Gemini File API 사용 (2GB 제한)

분할하지 않는 이유:
- AAC 프레임 경계 분할은 구현 복잡도가 높음
- File API가 2GB까지 지원하므로 대부분의 강의를 커버함

### Gemini STT

1. `.m4a` 파일 크기 확인
2. 20MB 이하 → `inlineData`로 직접 전송
3. 20MB 초과 → File API 업로드 → ACTIVE 상태 폴링 → STT 요청
4. 최대 3회 재시도 (지수 백오프)
5. 동시 변환 최대 2개 (`tokio::Semaphore`)

### 위키 페이지

1. 모듈 조회 시 위키 페이지도 함께 추출
2. 파일 다운로드: `reqwest` + 쿠키로 HTTPS 다운로드
3. PDF 요약: Gemini API에 PDF 직접 업로드 → 요약 텍스트 반환

## 진행률 이벤트

Rust에서 Tauri event emit → 프론트 JS에서 listen.

```
이벤트 채널:
- download-progress: { contentId, percent, status }
- transcribe-progress: { contentId, status }

status 값:
- 다운로드: downloading, extracting, done, error
- 변환: uploading, transcribing, done, error
```

## 데이터 관리 및 설정

### 저장 위치

OS별 앱 데이터 디렉토리 (Tauri `app_data_dir`):
- macOS: `~/Library/Application Support/ssu-lms-downloader/`
- Windows: `%APPDATA%/ssu-lms-downloader/`

### 파일 구성

```
app_data_dir/
├── download-history.json   # 다운로드 기록
├── wiki-history.json       # 위키 파일 기록
├── cookies.json            # 세션 쿠키
└── settings.json           # 사용자 설정
```

### 히스토리 레코드 구조

```json
{
  "contentId": "string",
  "title": "string",
  "courseId": "string",
  "courseName": "string",
  "filePath": "string",
  "format": "m4a",
  "fileSize": 0,
  "duration": 0,
  "downloadedAt": "ISO8601",
  "txtPath": "string | null",
  "summaryPath": "string | null"
}
```

기존 대비 변경: `format`이 `mp3` → `m4a`

### 설정 구조

```json
{
  "geminiApiKey": "string",
  "geminiModel": "gemini-2.0-flash",
  "downloadFolder": "string"
}
```

- API 키 저장: `tauri-plugin-store`로 로컬 암호화 저장 (Electron `safeStorage` 대체)

### 프론트엔드 ↔ Rust 통신

```javascript
// 요청-응답 (Tauri command)
const courses = await invoke('fetch_courses');
await invoke('download_video', { contentId: '123', format: 'm4a' });

// 이벤트 수신
listen('download-progress', (event) => {
  updateProgressBar(event.payload);
});
```

## 빌드 및 배포

### 빌드 설정 (tauri.conf.json)

- identifier: `com.ssu-lms-downloader`
- 번들 대상: macOS (`.dmg`), Windows (`.msi`/`.exe`)
- 자동 업데이트: 비활성화
- CSP: `default-src 'self'; connect-src https://canvas.ssu.ac.kr https://generativelanguage.googleapis.com`

### 예상 빌드 산출물 크기

```
macOS .dmg:   ~4-6MB
Windows .msi: ~4-6MB

내역:
  Rust 바이너리 (모든 로직 포함)    ~3-4MB
  프론트엔드 에셋 (HTML/CSS/JS)     ~100KB
  아이콘/이미지                      ~200KB
```

### Rust 의존성 (Cargo.toml)

```toml
[dependencies]
tauri = { version = "2", features = ["shell-open"] }
tauri-plugin-store = "2"
reqwest = { version = "0.12", features = ["cookies", "stream"] }
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
quick-xml = "0.37"
symphonia = { version = "0.5", features = ["mp4", "aac"] }
```

### 크로스 플랫폼 참고

- macOS: WebKit (Safari) — Canvas LMS 호환 테스트 필요
- Windows: WebView2 (Edge) — Windows 10 이상 기본 포함, 미설치 시 자동 다운로드 부트스트래퍼 옵션 있음

## 기존 Electron 대비 변경 요약

| 항목 | Electron (기존) | Tauri (신규) |
|------|----------------|-------------|
| 프레임워크 | Electron | Tauri v2 |
| 백엔드 언어 | TypeScript | Rust |
| 프론트엔드 | Vue 3 + Tailwind | Vanilla HTML/CSS/JS |
| 오디오 변환 | FFmpeg (MP3) | symphonia (AAC 추출) |
| API 키 저장 | safeStorage | tauri-plugin-store |
| 세션 관리 | session.fromPartition | reqwest cookie jar + 파일 저장 |
| Canvas API | executeJavaScript | reqwest 직접 호출 |
| 진행률 | IPC send/on | Tauri event emit/listen |
| 자동 업데이트 | electron-updater | 미지원 (수동 다운로드) |
| 앱 크기 | ~150MB+ | ~5MB |
