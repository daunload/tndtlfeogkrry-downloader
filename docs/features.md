# 기능 목록

## 1. 인증

| 항목           | 설명                                                                           |
| -------------- | ------------------------------------------------------------------------------ |
| **SSO 로그인** | Canvas LMS 로그인 페이지를 별도 BrowserWindow에서 열어 SSO 인증 처리           |
| **자동 감지**  | `canvas.ssu.ac.kr/?login_success=1` URL 감지 시 자동으로 창 숨김 및 성공 반환  |
| **수동 감지**  | 사용자가 창을 닫으면 현재 URL로 로그인 여부 판단 (`/login` 경로가 아니면 성공) |
| **세션 유지**  | `persist:lms` 파티션으로 세션 쿠키 영구 유지                                   |

## 2. 강좌 관리

| 항목               | 설명                                                                      |
| ------------------ | ------------------------------------------------------------------------- |
| **강좌 목록 조회** | Canvas `/api/v1/dashboard/dashboard_cards` API로 수강 중인 강좌 목록 조회 |
| **표시 정보**      | 강좌 ID, 약칭(shortName), 학기(term)                                      |
| **UI**             | 카드형 그리드 레이아웃 (`CourseList.vue`, `CourseCard.vue`)               |

## 3. 강의 영상 탐색

| 항목           | 설명                                                                       |
| -------------- | -------------------------------------------------------------------------- |
| **모듈 조회**  | LearningX API `/learningx/api/v1/courses/{id}/modules?include_detail=true` |
| **인증 방식**  | `xn_api_token` 쿠키를 Bearer 토큰으로 + CSRF 토큰 헤더                     |
| **영상 필터**  | `content_type`이 `everlec`, `movie`, `video`, `mp4`인 항목만 추출          |
| **메타데이터** | 제목, contentId, 재생시간(초), 파일크기(바이트), 썸네일URL, 주차           |

## 4. 영상 다운로드

### 4-1. 영상 URL 획득 (`services/lms.ts`)

- `commons.ssu.ac.kr/viewer/ssplayer/uniplayer_support/content.php`에서 XML 응답 파싱
- `extractMediaUrl()`로 미디어 URL 추출 (다중 경로 지원):
  1. `[MEDIA_FILE]` 템플릿 치환
  2. 직접 `.mp4` URL
  3. `desktop.html5.media_uri` 경로
  4. `content_uri` 기반 fallback 조합

### 4-2. 개별 다운로드 (`ipc/download.ts` → `services/download.ts`)

- 파일 저장 다이얼로그로 경로 선택
- MP4 또는 MP3 포맷 선택 가능
- 파일명 특수문자 자동 치환 (`/\?%*:|"<>` → `_`)

### 4-3. 일괄 다운로드 (`ipc/download.ts`)

- 폴더 선택 다이얼로그
- 최대 `MAX_CONCURRENT_DOWNLOADS`(3)개 동시 다운로드 (worker pool 패턴)
- 개별 성공/실패 결과 반환

### 4-4. 다운로드 엔진 (`services/download.ts`)

- Node.js `https.get` 사용
- `Referer: https://commons.ssu.ac.kr/` 헤더 필수
- 3xx 리다이렉트 자동 추적
- 타임아웃: `DOWNLOAD_TIMEOUT_MS` (300,000ms)
- 실시간 진행률 이벤트 (`IPC_EVENT.DOWNLOAD_PROGRESS`)

## 5. 오디오 처리 (`services/media.ts`)

### 5-1. MP4 → MP3 변환

- `convertToMp3()`: FFmpeg `libmp3lame` 코덱, 오디오 품질 2
- 변환 중 `status: 'converting'` 이벤트 전송 (percent: 92→95)

### 5-2. 대용량 MP3 분할

- `splitMp3()`: `SPLIT_THRESHOLD_BYTES`(19MB) 초과 시 자동 분할
- 파일 크기 기반으로 분할 수 계산 (`Math.ceil(fileSize / 19MB)`)
- FFmpeg `audioCodec('copy')`로 무손실 분할
- 분할 파일명: `{원본}_part{N}.mp3`
- 분할 완료 후 원본 MP3 삭제
- 진행률: percent 96~100 구간에서 splitting 상태 전송

## 6. AI 음성→텍스트 변환 (STT)

### 6-1. Gemini API 키 관리 (`services/gemini.ts`)

- **저장**: `saveGeminiApiKey()` — `safeStorage.encryptString()` → `userData/gemini-key.enc`
- **로드**: `loadGeminiApiKey()` — `safeStorage.decryptString()`
- **삭제**: `deleteGeminiApiKey()` — 파일 내용을 빈 문자열로 덮어쓰기

### 6-2. 전송 방식 선택

UI에서 **File API** 체크박스로 두 가지 전송 방식을 선택할 수 있다:

| 방식 | 설명 | 장점 |
|---|---|---|
| **inlineData** (기본) | MP3를 base64 인코딩하여 요청 본문에 포함 | 추가 네트워크 호출 없음 |
| **File API** | `GoogleAIFileManager`로 파일 업로드 후 URI 참조 | 토큰 절약, 2GB까지 지원 |

File API 사용 시:
- `uploadAndWaitForActive()`로 파일 업로드 → ACTIVE 상태 대기
- `fileData: { fileUri, mimeType }`로 API 요청
- 변환 완료 후 `deleteUploadedFile()`로 업로드된 파일 자동 정리 (실패 시 48시간 후 자동 만료)

### 6-3. 단일 파일 변환 (`ipc/transcribe.ts`)

- 선택된 전송 방식(inlineData/File API)으로 Gemini API에 전송
- 프롬프트: 한국어 텍스트로 받아쓰기, 전문 용어 정확 표기, 문단 구분
- 분할 파일 자동 감지: `_partN.mp3` 패턴으로 같은 원본의 분할 파일을 모두 찾아 순서대로 변환 후 병합
- 결과: 같은 디렉토리에 `{baseName}.txt` 파일 생성

### 6-4. 일괄 변환 (`ipc/transcribe.ts`)

- `groupMp3Files()` (`services/gemini.ts`)로 지정 폴더의 모든 MP3 파일 그룹핑
- 분할 파일은 같은 그룹으로 묶음
- 최대 `MAX_CONCURRENT_TRANSCRIPTIONS`(2)개 동시 변환 (worker pool 패턴)

### 6-5. 다운로드 + 변환 통합 (`ipc/transcribe.ts`)

- 1단계: 전체 영상 MP3 다운로드 (최대 `MAX_CONCURRENT_DOWNLOADS`개 동시)
- 2단계: 다운로드된 MP3 그룹별 텍스트 변환 (최대 `MAX_CONCURRENT_TRANSCRIPTIONS`개 동시)
- 모든 다운로드 실패 시 2단계 스킵

### 6-6. 에러 처리 (`services/gemini.ts`)

- **Rate limit (429)**: `transcribeWithRetry()`로 지수 백오프 재시도 (2초 → 4초 → 8초, 최대 `GEMINI_MAX_RETRIES`회)
- **인증 오류 (401/403)**: API 키 재설정 안내
- 변환 실패 시 `status: 'error'` 이벤트 전송

## 7. UI/UX

| 항목            | 설명                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------- |
| **테마**        | 다크/라이트 모드 토글, `localStorage`에 저장, `document.documentElement`에 `dark` 클래스 |
| **반응형**      | 모바일/태블릿/데스크톱 레이아웃                                                          |
| **사이드바**    | 강좌 목록, Gemini API 설정, 테마 토글, 로그인 상태/버튼                                  |
| **포맷 선택**   | 드롭다운으로 MP4/MP3/텍스트 변환 선택                                                    |
| **File API**    | 체크박스로 Gemini File API 전송 방식 토글                                                |
| **진행률**      | 원형 프로그레스바 + 퍼센트 표시 (`ProgressBar.vue`)                                      |
| **상태 메시지** | 하단 중앙 플로팅 토스트 — 변환 단계별 실시간 표시 (`StatusMessage.vue`)                   |
| **영상 카드**   | 썸네일(호버 확대), 메타데이터, 다운로드/변환 버튼, 상태 배지                             |

## 8. 자동 업데이트

- `electron-updater`로 프로덕션 환경에서만 업데이트 체크
- `autoDownload: true` — 백그라운드 자동 다운로드
- `autoInstallOnAppQuit: true` — 앱 종료 시 자동 설치
- `electron-log`로 업데이트 로그 기록

## 9. 기타

| 항목          | 설명                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| **파일 열기** | `shell.openPath()`로 네이티브 앱에서 파일 열기                                                                |
| **폴더 선택** | `dialog.showOpenDialog()`로 폴더 선택 다이얼로그                                                              |
| **asar 호환** | `services/media.ts`에서 FFmpeg 바이너리 경로 `app.asar` → `app.asar.unpacked` 보정                            |
| **앱 종료**   | `window.ts`의 `destroyLmsWin()`으로 LMS 창 명시적 파괴 (`before-quit` 이벤트), macOS는 창 전체 닫혀도 앱 유지 |
