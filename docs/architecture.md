# 아키텍처

## 기술 스택

- **런타임**: Electron (v39)
- **프론트엔드**: Vue 3 + TypeScript + Tailwind CSS v4
- **빌드**: electron-vite + Vite 7
- **미디어 처리**: FFmpeg (fluent-ffmpeg + @ffmpeg-installer/ffmpeg)
- **AI**: Google Generative AI (@google/generative-ai + /server) — Gemini API + File API
- **XML 파싱**: fast-xml-parser
- **자동 업데이트**: electron-updater + electron-log
- **아이콘**: lucide-vue-next
- **패키지 매니저**: pnpm

## 프로젝트 구조

```
src/
├── shared/                        # main/preload/renderer 공유
│   ├── types.ts                   # 도메인 타입 (CourseItem, VideoItem, VideoRef 등)
│   ├── channels.ts                # IPC 채널명 상수 (IPC, IPC_EVENT)
│   └── config.ts                  # 설정 상수 (임계값, 동시성 제한 등)
├── main/
│   ├── index.ts                   # 앱 라이프사이클 (~40줄)
│   ├── window.ts                  # BrowserWindow 관리 (createWindow, LMS 싱글턴)
│   ├── services/
│   │   ├── gemini.ts              # API 키 관리 + 텍스트 변환 (inlineData/File API 분기)
│   │   ├── media.ts               # FFmpeg: MP3 변환, 오디오 분할
│   │   ├── lms.ts                 # XML 파싱으로 미디어 URL 추출
│   │   └── download.ts            # HTTPS 다운로드 + 단일 비디오 다운로드
│   └── ipc/
│       ├── index.ts               # registerAllIpcHandlers() 집계
│       ├── auth.ts                # open-login
│       ├── courses.ts             # fetch-courses, fetch-modules
│       ├── download.ts            # download-video, download-all
│       ├── transcribe.ts          # transcribe-audio, transcribe-batch, download-and-transcribe-all
│       └── settings.ts            # API키 CRUD + open-file + select-folder
├── preload/
│   ├── index.ts                   # contextBridge로 renderer에 API 노출 (shared 채널/타입 사용)
│   └── index.d.ts                 # preload API 타입 정의 (shared 타입 import)
└── renderer/src/
    ├── App.vue                    # 루트 컴포넌트 (화면 전환, 상태 관리)
    ├── main.ts                    # Vue 앱 엔트리포인트
    ├── types/index.ts             # shared/types.ts에서 re-export
    ├── composables/
    │   ├── useDownloader.ts       # 다운로드 상태/로직 컴포저블
    │   ├── useTranscriber.ts      # 텍스트 변환 상태/로직 컴포저블
    │   └── useTheme.ts            # 다크/라이트 테마 토글
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
        │   ├── VideoList.vue      # 강의 영상 목록 (File API 토글 포함)
        │   ├── VideoCard.vue      # 영상 카드 (썸네일, 다운로드, 변환 상태)
        │   └── ProgressBar.vue    # 원형 진행률 표시기
        └── settings/
            └── ApiKeySettings.vue # Gemini API 키 관리 모달
```

## 모듈 의존성 흐름

```
shared/          ← 모든 프로세스에서 import (타입, 채널명, 설정)
  ↑
main/
  index.ts       → window.ts, ipc/index.ts  (앱 초기화만)
  window.ts      → shared/config             (LMS 세션 파티션)
  services/*     → shared/config, channels   (비즈니스 로직)
  ipc/*          → services/*, window.ts     (IPC 핸들러 → 서비스 호출)

preload/         → shared/channels, types    (채널 상수로 invoke/on)

renderer/        → shared/types (re-export)  (프론트엔드)
```

## 프로세스 구조

```
┌─────────────────┐     IPC (invoke/handle)     ┌──────────────────────────┐
│  Renderer        │ ◄─────────────────────────► │  Main Process            │
│  (Vue 3 App)     │                             │                          │
│                  │     IPC (send/on)           │  index.ts (라이프사이클)  │
│  - App.vue       │ ◄────────────────────────── │    ├─ window.ts          │
│  - composables   │   download-progress         │    ├─ ipc/ (핸들러)      │
│  - components    │   transcribe-progress       │    └─ services/ (로직)   │
└─────────────────┘                              └──────────┬───────────────┘
                                                            │
                                                 ┌──────────▼───────────────┐
                                                 │  LMS Window              │
                                                 │  (BrowserWindow)         │
                                                 │  persist:lms 세션        │
                                                 │  - Canvas 로그인         │
                                                 │  - API 호출              │
                                                 └──────────────────────────┘
```

## 세션 관리

- `persist:lms` 파티션을 사용하는 별도 BrowserWindow로 Canvas LMS 세션 유지
- LMS 창은 `window.ts`의 싱글턴으로 관리, 닫기 시 파괴하지 않고 숨김 처리 (재사용)
- Canvas API 호출은 LMS 창의 `executeJavaScript`로 세션 쿠키를 자동 포함
- content.php API는 `getLmsSession().fetch()`로 직접 호출

## 보안

- Gemini API 키: `safeStorage.encryptString()`으로 OS 수준 암호화 후 `userData/gemini-key.enc`에 저장
- Preload에서 `contextBridge`로 허용된 API만 renderer에 노출

## 새 기능 추가 가이드

### 새 IPC 채널 추가

1. `src/shared/channels.ts` — `IPC` 또는 `IPC_EVENT`에 채널명 상수 추가
2. `src/main/ipc/` — 해당 도메인 파일에 핸들러 구현
3. `src/preload/index.ts` — API 메서드 추가
4. `src/preload/index.d.ts` — 타입 정의 추가

### 새 서비스 로직 추가

1. `src/main/services/` — 비즈니스 로직 파일 생성/수정
2. `src/main/ipc/` — 해당 IPC 핸들러에서 서비스 import 및 호출

### 새 공유 타입 추가

1. `src/shared/types.ts` — 타입 정의
2. 필요 시 `src/renderer/src/types/index.ts`에 re-export 추가
