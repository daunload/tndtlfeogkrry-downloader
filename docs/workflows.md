# 핵심 워크플로우

## 1. 로그인 플로우

```
사용자 → [로그인 버튼 클릭]
  → IPC: open-login (ipc/auth.ts)
  → Main: getOrCreateLmsWin() (window.ts) → canvas.ssu.ac.kr/login 로드
  → 사용자: SSO 인증 수행
  → Main: did-navigate 이벤트로 URL 감시
    ├─ login_success=1 포함 → 성공, 창 숨김
    └─ 사용자가 창 닫음 → 현재 URL로 로그인 여부 판단
  → Renderer: 로그인 상태 업데이트, 강좌 목록 화면 전환
```

## 2. 강좌 → 영상 목록 플로우

```
사용자 → [강좌 카드 클릭]
  → IPC: fetch-modules(courseId) (ipc/courses.ts)
  → Main: LMS 창에서 executeJavaScript로 LearningX API 호출
    → xn_api_token + CSRF 토큰으로 인증
    → 모듈 데이터에서 영상 항목 필터링 (everlec/movie/video/mp4)
  → Renderer: VideoList 렌더링
```

## 3. 개별 다운로드 플로우

```
사용자 → [다운로드 버튼 클릭]
  → IPC: download-video(contentId, title, format) (ipc/download.ts)
  → Main: dialog.showSaveDialog → 저장 경로 선택
  → Main: downloadOne() (services/download.ts)
    → content.php API 호출 → extractMediaUrl() (services/lms.ts) → 미디어 URL 추출
    → downloadFile()로 다운로드 (리다이렉트 자동 추적)
    → download-progress 이벤트 전송 (0~100%)
  → [MP3인 경우]
    → MP4를 임시 파일로 다운로드 (0~90%)
    → convertToMp3() (services/media.ts) → MP3 변환 (92~95%)
    → splitMp3() → 19MB 초과 시 분할 (96~100%)
    → 임시 MP4 삭제
  → Renderer: 진행률 UI 업데이트
```

## 4. 일괄 다운로드 플로우

```
사용자 → [전체 다운로드 버튼 클릭]
  → IPC: download-all(videos[], format) (ipc/download.ts)
  → Main: dialog.showOpenDialog → 폴더 선택
  → Main: Worker Pool (최대 MAX_CONCURRENT_DOWNLOADS개 동시)
    → 각 영상에 대해 downloadOne() 실행
    → 개별 download-progress 이벤트 (contentId로 구분)
  → Renderer: 영상별 진행률 독립 추적
  → Main: 전체 결과 반환 (성공/실패 수)
```

## 5. 텍스트 변환 플로우 (단일)

```
사용자 → [변환 버튼 클릭] (File API 체크박스로 전송 방식 선택)
  → IPC: transcribe-audio(filePath, withSummary, useFileApi) (ipc/transcribe.ts)
  → Main: loadGeminiApiKey() (services/gemini.ts) → API 키 확인
  → Main: 분할 파일 감지 (_partN.mp3 패턴)
    ├─ 분할 파일 있음 → 모든 파트 순서대로 변환
    └─ 단일 파일 → 해당 파일만 변환
  → 각 파트:
    → [inlineData 모드] MP3 → base64 인코딩 → 요청 본문에 포함
    → [File API 모드] uploadAndWaitForActive() → fileUri 참조로 요청
    → transcribeWithRetry() → Gemini API 호출 (한국어 트랜스크립션)
    → transcribe-progress 이벤트 전송 (uploading → transcribing)
    → 429 에러 시 지수 백오프 재시도
    → [File API 모드] 변환 완료 후 업로드된 파일 자동 삭제
  → 텍스트 병합 → {baseName}.txt 저장
  → Renderer: 하단 토스트에 단계별 상태 실시간 표시
```

## 6. 다운로드 + 변환 통합 플로우

```
사용자 → [다운로드 & 변환 버튼 클릭]
  → IPC: download-and-transcribe-all(videos[]) (ipc/transcribe.ts)
  → Main: 폴더 선택 다이얼로그

  [1단계: 다운로드]
  → Worker Pool (최대 MAX_CONCURRENT_DOWNLOADS개)로 전체 MP3 다운로드
  → 각 영상: downloadOne() → MP3 변환 → 분할
  → 전체 다운로드 실패 시 중단

  [2단계: 텍스트 변환]
  → groupMp3Files() (services/gemini.ts)로 폴더 내 MP3 파일 그룹핑
  → Worker Pool (최대 MAX_CONCURRENT_TRANSCRIPTIONS개)로 그룹별 변환
  → 각 그룹: 파트별 transcribeWithRetry() → 텍스트 병합 → .txt 저장

  → Renderer: 다운로드/변환 각각의 성공 수 표시
```

## 공유 타입 (`src/shared/types.ts`)

```typescript
// 강좌
interface CourseItem {
  id: string;
  name: string; // shortName
  term: string; // 학기
}

// 영상
interface VideoItem {
  title: string;
  contentId: string;
  duration: number; // 초 단위
  fileSize: number; // 바이트 단위
  thumbnailUrl: string;
  weekPosition: number; // 주차
}

// 다운로드/변환 요청용 최소 참조
interface VideoRef {
  contentId: string;
  title: string;
}
```

## 설정 상수 (`src/shared/config.ts`)

| 상수                            | 값                 | 설명              |
| ------------------------------- | ------------------ | ----------------- |
| `LMS_SESSION_PARTITION`         | `persist:lms`      | LMS 세션 파티션명 |
| `SPLIT_THRESHOLD_BYTES`         | 19MB               | MP3 분할 기준     |
| `MAX_CONCURRENT_DOWNLOADS`      | 3                  | 동시 다운로드 수  |
| `MAX_CONCURRENT_TRANSCRIPTIONS` | 2                  | 동시 변환 수      |
| `DEFAULT_GEMINI_MODEL`          | `gemini-2.5-flash` | STT 기본 모델명   |
| `GEMINI_MAX_RETRIES`            | 3                  | API 재시도 횟수   |
| `DOWNLOAD_TIMEOUT_MS`           | 300,000            | 다운로드 타임아웃 |

## 동시성 제한

| 작업              | 최대 동시 수 | 상수                            | 구현                     |
| ----------------- | ------------ | ------------------------------- | ------------------------ |
| 영상 다운로드     | 3            | `MAX_CONCURRENT_DOWNLOADS`      | Worker Pool              |
| 텍스트 변환       | 2            | `MAX_CONCURRENT_TRANSCRIPTIONS` | Worker Pool              |
| Gemini API 재시도 | 3회          | `GEMINI_MAX_RETRIES`            | 지수 백오프 (2s, 4s, 8s) |

## 외부 API 엔드포인트

| API                                                      | 용도                |
| -------------------------------------------------------- | ------------------- |
| `canvas.ssu.ac.kr/login`                                 | SSO 로그인 페이지   |
| `canvas.ssu.ac.kr/api/v1/dashboard/dashboard_cards`      | 수강 강좌 목록      |
| `canvas.ssu.ac.kr/learningx/api/v1/courses/{id}/modules` | 강좌 모듈/영상 목록 |
| `commons.ssu.ac.kr/.../content.php?content_id={id}`      | 영상 URL 조회 (XML) |
| `generativelanguage.googleapis.com` (via SDK)            | Gemini STT          |
