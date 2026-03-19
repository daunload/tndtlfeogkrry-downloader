# 아키텍처

## 기술 스택

- **런타임**: Electron (v39)
- **프론트엔드**: Vue 3 + TypeScript + Tailwind CSS v4
- **빌드**: electron-vite + Vite 7
- **미디어 처리**: FFmpeg (fluent-ffmpeg + @ffmpeg-installer/ffmpeg)
- **AI**: Google Generative AI (@google/generative-ai) - Gemini 2.0 Flash
- **XML 파싱**: fast-xml-parser
- **자동 업데이트**: electron-updater + electron-log
- **아이콘**: lucide-vue-next
- **패키지 매니저**: pnpm

## 프로젝트 구조

```
src/
├── main/index.ts              # Electron 메인 프로세스 (IPC 핸들러, 다운로드, 변환, STT)
├── preload/
│   ├── index.ts               # contextBridge로 renderer에 API 노출
│   └── index.d.ts             # preload API 타입 정의
└── renderer/src/
    ├── App.vue                # 루트 컴포넌트 (화면 전환, 상태 관리)
    ├── main.ts                # Vue 앱 엔트리포인트
    ├── types/index.ts         # 공용 타입 (CourseItem, VideoItem)
    ├── composables/
    │   ├── useDownloader.ts   # 다운로드 상태/로직 컴포저블
    │   ├── useTranscriber.ts  # 텍스트 변환 상태/로직 컴포저블
    │   └── useTheme.ts        # 다크/라이트 테마 토글
    └── components/
        ├── layout/
        │   ├── Sidebar.vue        # 사이드바 (강좌목록, API설정, 테마, 로그인)
        │   ├── AppHeader.vue      # 상단 헤더
        │   └── StatusMessage.vue  # 하단 플로팅 알림
        ├── login/
        │   └── LoginScreen.vue    # 미인증 상태 로그인 화면
        ├── courses/
        │   ├── CourseList.vue     # 수강 강좌 그리드
        │   └── CourseCard.vue     # 개별 강좌 카드
        ├── videos/
        │   ├── VideoList.vue      # 강의 영상 목록
        │   ├── VideoCard.vue      # 영상 카드 (썸네일, 다운로드, 변환)
        │   ├── FormatToggle.vue   # MP4/MP3 포맷 전환
        │   └── ProgressBar.vue    # 원형 진행률 표시기
        └── settings/
            └── ApiKeySettings.vue # Gemini API 키 관리 모달
```

## 프로세스 구조

```
┌─────────────────┐     IPC (invoke/handle)     ┌──────────────────┐
│  Renderer        │ ◄─────────────────────────► │  Main Process    │
│  (Vue 3 App)     │                             │  (index.ts)      │
│                  │     IPC (send/on)           │                  │
│  - App.vue       │ ◄────────────────────────── │  - 다운로드      │
│  - composables   │   download-progress         │  - FFmpeg 변환   │
│  - components    │   transcribe-progress       │  - Gemini STT    │
└─────────────────┘                              │  - 세션 관리     │
                                                 └──────┬───────────┘
                                                        │
                                                 ┌──────▼───────────┐
                                                 │  LMS Window      │
                                                 │  (BrowserWindow)  │
                                                 │  persist:lms 세션 │
                                                 │  - Canvas 로그인  │
                                                 │  - API 호출       │
                                                 └──────────────────┘
```

## 세션 관리

- `persist:lms` 파티션을 사용하는 별도 BrowserWindow로 Canvas LMS 세션 유지
- LMS 창은 닫기 시 파괴하지 않고 숨김 처리 (재사용)
- Canvas API 호출은 LMS 창의 `executeJavaScript`로 세션 쿠키를 자동 포함
- content.php API는 `lmsSession.fetch()`로 직접 호출

## 보안

- Gemini API 키: `safeStorage.encryptString()`으로 OS 수준 암호화 후 `userData/gemini-key.enc`에 저장
- Preload에서 `contextBridge`로 허용된 API만 renderer에 노출
