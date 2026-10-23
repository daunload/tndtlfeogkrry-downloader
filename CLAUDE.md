# Soongsil LMS Downloader

숭실대 Canvas LMS 강의 영상 다운로드 및 텍스트 변환(Gemini API 또는 로컬 Whisper) Electron 데스크톱 앱.

## 기술 스택

- **프레임워크**: Electron + electron-vite
- **프론트엔드**: Vue 3 (Composition API) + TypeScript + Tailwind CSS 4
- **백엔드(main)**: TypeScript (Node.js)
- **빌드**: electron-vite (Vite + Rollup), electron-builder
- **주요 라이브러리**: fluent-ffmpeg, fast-xml-parser, @google/generative-ai, @huggingface/transformers (renderer 번들 전용 → devDependencies), electron-updater

## 프로젝트 구조

```
src/
├── shared/              # main/preload/renderer 공유 (타입, 채널명, 설정 상수)
│   ├── types.ts         # 도메인 타입 (CourseItem, VideoItem 등)
│   ├── channels.ts      # IPC 채널명 상수 (IPC, IPC_EVENT)
│   └── config.ts        # 설정 상수 (임계값, 동시성 제한 등)
├── main/
│   ├── index.ts         # 앱 라이프사이클만 (~40줄)
│   ├── window.ts        # BrowserWindow 관리 (createWindow, LMS 윈도우 싱글턴)
│   ├── services/        # 비즈니스 로직
│   │   ├── gemini.ts    # API 키 관리 + 텍스트 변환 (transcribeWithRetry)
│   │   ├── whisper.ts   # 로컬 Whisper 브리지 (PCM 디코딩 → renderer Worker로 전사 요청)
│   │   ├── transcribeEngine.ts # 변환 엔진 설정 (gemini | whisper)
│   │   ├── media.ts     # FFmpeg: MP3 변환, 분할, 16kHz PCM 디코딩
│   │   ├── lms.ts       # XML 파싱으로 미디어 URL 추출
│   │   └── download.ts  # HTTPS 다운로드 + 단일 비디오 다운로드
│   └── ipc/             # IPC 핸들러 (채널별 분리)
│       ├── index.ts     # registerAllIpcHandlers()
│       ├── auth.ts      # open-login
│       ├── courses.ts   # fetch-courses, fetch-modules
│       ├── download.ts  # download-video, download-all
│       ├── transcribe.ts # transcribe-audio, transcribe-batch, download-and-transcribe-all
│       └── settings.ts  # API키 CRUD + open-file + select-folder
├── preload/             # contextBridge API (shared 채널/타입 사용)
└── renderer/src/        # Vue 프론트엔드
    └── whisper/         # transformers.js Web Worker + main ↔ worker 브리지
```

## 주요 명령어

```bash
pnpm dev              # 개발 서버 실행
pnpm build            # 타입체크 + 빌드
pnpm typecheck        # 타입체크만 (node + web)
pnpm typecheck:node   # main/preload 타입체크
pnpm typecheck:web    # renderer 타입체크
pnpm lint             # ESLint
pnpm format           # Prettier
pnpm build:mac        # macOS 패키징
pnpm build:win        # Windows 패키징
```

## 아키텍처 패턴

### IPC 통신

- **채널명**: `src/shared/channels.ts`의 `IPC`/`IPC_EVENT` 상수 사용 (문자열 하드코딩 금지)
- **Invoke/Handle**: `ipcRenderer.invoke` ↔ `ipcMain.handle` (요청-응답)
- **Send/On**: `sender.send` → `ipcRenderer.on` (진행률 등 단방향 이벤트)

### LMS 세션

- `persist:lms` 파티션의 별도 BrowserWindow로 Canvas LMS 로그인 세션 유지
- `lmsWin`은 `window.ts`의 싱글턴, 닫기 시 숨기기만 함
- `getLmsSession().fetch()`로 인증된 API 호출

### 다운로드/변환 파이프라인

1. `content.php` API → XML 파싱 → 미디어 URL 추출
2. HTTPS 다운로드 (진행률 이벤트 발송)
3. MP3 요청 시: MP4 → FFmpeg MP3 변환 → 19MB 초과 시 자동 분할
4. 텍스트 변환: 엔진에 따라 분할 파일 순차 변환 → 병합
   - Gemini: API 호출
   - Whisper: main이 ffmpeg로 16kHz PCM 디코딩 → `whisper-job` 이벤트로 renderer에 청크 전송 → Web Worker(transformers.js, WebGPU)에서 전사 → `whisper-job-result`로 반환. 모델(`onnx-community/whisper-large-v3-turbo`)은 첫 실행 시 Hub에서 받아 Cache Storage에 저장
5. 요약본: 항상 Gemini 사용 (Whisper 엔진이라도 API 키가 있을 때만 생성)

### 동시성

- 다운로드: 최대 3개 병렬 (worker 패턴)
- 텍스트 변환: Gemini 최대 2개 병렬, Whisper 1개씩 (GPU 공유)

## 중요 규칙

- **타입 정의**: `src/shared/types.ts`에 도메인 타입 정의, preload/renderer에서 import
- **새 IPC 채널 추가 시**: channels.ts 상수 추가 → ipc/ 핸들러 파일에 구현 → preload에 API 추가 → preload/index.d.ts 타입 추가
- **설정 상수**: `src/shared/config.ts`에 중앙 관리
- **FFmpeg**: `services/media.ts` import 시 자동 초기화
- **외부 모듈 번들링 제외**: `electron.vite.config.ts`의 `external` 배열 확인
