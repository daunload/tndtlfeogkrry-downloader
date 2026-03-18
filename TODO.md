# TODO

## 1. 전체 다운로드 병렬처리

현재 `download-all` 핸들러는 `for` 루프로 순차 처리 중 (`src/main/index.ts:442`).
각 영상이 완료될 때까지 다음 다운로드가 시작되지 않아 전체 소요 시간이 길다.

### 백엔드 (Main Process - `src/main/index.ts`)
- [ ] 동시 다운로드 개수 제한 (최대 N개, 기본값 3) 적용한 병렬 큐 구현
  - `download-all` 핸들러의 순차 `for` 루프를 병렬 큐로 교체
  - `p-limit` 등 concurrency 라이브러리 사용 또는 직접 구현
- [ ] 각 다운로드별 독립적인 진행률 전송 (현재 `contentId` 기반으로 이미 구분됨, 동시 전송만 처리)
- [ ] 개별 다운로드 실패 시 나머지 다운로드에 영향 없도록 에러 격리
- [ ] 다운로드별 BrowserWindow가 동시에 여러 개 생성되므로 리소스 관리 주의

### 프론트엔드 (Renderer - `src/renderer/src/composables/useDownloader.ts`)
- [ ] 전체 진행 상태 표시 (예: "3/10 완료", 전체 진행률 바)
- [ ] 개별 영상별 진행률은 현재 `progressMap`으로 이미 지원됨 — 동시 업데이트만 확인
- [ ] 전체 다운로드 취소 기능 (진행 중인 모든 다운로드 중단)

### 고려사항
- `downloadOne()`이 내부적으로 BrowserWindow를 생성하므로 동시 개수가 많으면 메모리 부담
- LMS 서버 부하를 고려하여 동시 다운로드 수를 3개 이하로 제한 권장
- MP3 변환(`ffmpeg`)도 CPU를 사용하므로 변환 단계는 별도 큐로 분리하는 것이 이상적

## 2. MP3 파일 분할

MP3 변환 후 파일이 20MB를 초과하면 자동으로 분할한다.
Gemini API 음성-텍스트 변환(3번 작업)의 입력 제한(20MB)을 충족하기 위한 선행 작업이다.

### 백엔드 (Main Process - `src/main/index.ts`)
- [ ] MP3 파일 분할 함수 구현 (`splitMp3`)
  - `fluent-ffmpeg`로 전체 오디오 길이(duration) 조회
  - 20MB 기준으로 필요한 분할 수 계산 (파일 크기 / 19MB, 여유분 확보)
  - 균등 시간 분할: `총 duration / 분할 수`로 각 파트의 시작·종료 시간 산출
  - ffmpeg `-ss`, `-t` 옵션으로 구간별 MP3 추출 (`-c copy`로 재인코딩 없이 빠르게 분할)
  - 출력 파일명: `원본명_part1.mp3`, `원본명_part2.mp3`, ...
- [ ] `convertToMp3()` 완료 후 파일 크기 확인 → 20MB 초과 시 `splitMp3()` 호출
  - 분할 완료 후 원본 MP3 파일 삭제 (분할 파일만 유지)
- [ ] 분할 진행률을 렌더러에 전송
  - 기존 `download-progress` 이벤트 활용, `percent` 95~100% 구간에서 분할 진행 표시
  - 또는 별도 `split-progress` 이벤트 신설

### 프론트엔드 (Renderer)
- [ ] 분할 진행 상태 UI 표시 (예: "MP3 분할 중... (2/4)")
- [ ] 분할 결과 표시: 분할된 파일 개수 안내

### 고려사항
- `-c copy`(스트림 복사)는 재인코딩 없이 빠르지만, 정확한 지점에서 잘리지 않을 수 있음 → 음성 변환 용도이므로 수 초 오차는 허용
- VBR(가변 비트레이트) MP3는 파일 크기와 시간이 비례하지 않을 수 있으므로, 분할 후 각 파트가 20MB 이하인지 검증 필요
  - 초과 시 해당 파트를 재분할하는 재귀 로직 또는 더 작은 단위로 재시도
- 분할 기준(20MB)은 3번 작업(Gemini API)의 제한에 맞춤 — API 제한 변경 시 함께 조정
- ffmpeg 바이너리는 이미 번들되어 있으므로 (`@ffmpeg-installer/ffmpeg`) 추가 의존성 불필요

## 3. Gemini 연동 음성-텍스트 변환

다운로드한 MP3 파일을 Google Gemini API로 텍스트 변환(STT)하여 `.txt` 파일로 저장한다.
분할된 MP3(`_part1.mp3`, `_part2.mp3`, ...)는 순서대로 변환 후 하나의 텍스트 파일로 합친다.

### 사전 준비
- [ ] `@google/generative-ai` SDK 설치 (`pnpm add @google/generative-ai`)
- [ ] Gemini API 키 관리
  - 설정 화면에서 API 키 입력 → `electron-store` 또는 `safeStorage`로 암호화 저장
  - 키 미설정 시 변환 버튼 비활성화 + 설정 안내 표시

### 백엔드 (Main Process - `src/main/index.ts`)

#### IPC 핸들러
- [ ] `transcribe-audio` 핸들러 추가 — 단일 MP3 파일 변환
  ```ts
  ipcMain.handle('transcribe-audio', async (event, filePath: string): Promise<TranscribeResult>)
  // TranscribeResult = { success: boolean; text?: string; error?: string }
  ```
- [ ] `transcribe-batch` 핸들러 추가 — 다운로드된 전체 영상의 MP3를 일괄 변환
  ```ts
  ipcMain.handle('transcribe-batch', async (event, dirPath: string): Promise<TranscribeBatchResult>)
  // TranscribeBatchResult = { success: boolean; results: { fileName: string; success: boolean; error?: string }[]; successCount: number; total: number }
  ```
- [ ] `set-gemini-api-key` / `get-gemini-api-key` 핸들러 — API 키 저장/조회

#### 변환 로직 (`transcribeOne()`)
- [ ] MP3 파일을 `fs.readFileSync()`로 읽어 base64 인코딩
- [ ] Gemini API 호출 (File API 사용)
  ```ts
  import { GoogleGenerativeAI } from '@google/generative-ai'

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

  const result = await model.generateContent([
    { inlineData: { mimeType: 'audio/mp3', data: base64Audio } },
    { text: '이 오디오의 내용을 한국어 텍스트로 정확하게 받아적어주세요. 강의 내용이므로 전문 용어를 정확히 표기하고, 문단을 적절히 나눠주세요.' }
  ])
  ```
- [ ] **분할 파일 병합**: `_part1.mp3`, `_part2.mp3`, ... 패턴 감지
  - 같은 원본에서 분할된 파트들을 순서대로 변환
  - 각 파트의 변환 결과를 `\n\n` 구분자로 합쳐 하나의 텍스트 파일로 저장
  - 파일명: `영상제목.txt` (파트 번호 없이 통합)
- [ ] 결과 텍스트를 `.txt` 파일로 저장 (MP3와 같은 디렉토리)

#### 진행률 전송
- [ ] `transcribe-progress` 이벤트 신설
  ```ts
  event.sender.send('transcribe-progress', {
    fileName: string,        // 현재 처리 중인 파일명
    percent: number,         // 0-100
    status: 'transcribing' | 'merging' | 'done' | 'error',
    currentPart?: number,    // 분할 파일인 경우 현재 파트
    totalParts?: number,     // 분할 파일인 경우 전체 파트 수
    // 일괄 변환 시
    currentFile?: number,    // 현재 파일 번호 (배치)
    totalFiles?: number      // 전체 파일 수 (배치)
  })
  ```

#### 에러 처리
- [ ] API 키 유효성 검증 (첫 호출 시 401/403 → 키 재설정 안내)
- [ ] Rate limit 처리 (429 → 지수 백오프 재시도, 최대 3회)
- [ ] 파일 크기 제한 검증 (20MB 초과 시 에러 반환 — 2번 작업에서 이미 분할되어야 함)
- [ ] 네트워크 에러 → 재시도 옵션 제공
- [ ] 개별 파일 실패 시 나머지 파일에 영향 없도록 에러 격리 (배치 모드)

### 프론트엔드 (Renderer)

#### Preload API 확장 (`src/preload/index.ts`)
- [ ] `window.api`에 추가:
  ```ts
  transcribeAudio(filePath: string): Promise<TranscribeResult>
  transcribeBatch(dirPath: string): Promise<TranscribeBatchResult>
  setGeminiApiKey(key: string): Promise<{ success: boolean }>
  getGeminiApiKey(): Promise<{ hasKey: boolean }>
  onTranscribeProgress(callback): void
  removeTranscribeProgress(): void
  ```

#### 컴포저블 (`src/renderer/src/composables/useTranscriber.ts`)
- [ ] 새 컴포저블 생성
  ```ts
  const hasApiKey = ref(false)
  const isTranscribing = ref(false)
  const transcribeProgressMap = ref<Record<string, number>>()     // fileName → percent
  const transcribeStatusMap = ref<Record<string, TranscribeStatus>>()
  ```
- [ ] `transcribe(filePath)` — 단일 파일 변환 실행
- [ ] `transcribeBatch(dirPath)` — 일괄 변환 실행
- [ ] `checkApiKey()` — API 키 설정 여부 확인 (앱 시작 시 호출)
- [ ] `onTranscribeProgress` 리스너 등록/해제

#### UI 컴포넌트
- [ ] **API 키 설정 UI** (`src/renderer/src/components/settings/ApiKeyInput.vue`)
  - Sidebar 또는 설정 모달에 배치
  - 키 입력 필드 + 저장 버튼
  - 설정 완료 시 체크 아이콘 표시
- [ ] **변환 버튼 추가** (`VideoCard.vue` / `VideoList.vue`)
  - 다운로드 완료된 영상에 "텍스트 변환" 버튼 표시 (lucide: `FileText` 아이콘)
  - MP3 다운로드 완료 상태(`status === 'done'`)일 때만 활성화
  - "전체 텍스트 변환" 버튼 — 다운로드 완료된 모든 영상 일괄 변환
- [ ] **변환 진행률 표시**
  - 기존 ProgressBar 패턴 재활용, 색상 구분 (예: 보라색 계열로 다운로드와 시각 구분)
  - 상태 라벨: "텍스트 변환 중...", "파트 병합 중...", "변환 완료"
  - 배치 모드: "텍스트 변환 중 (3/10)" 전체 진행 표시
- [ ] **변환 결과 표시**
  - 완료 시 "텍스트 파일 열기" 버튼 (lucide: `ExternalLink`)
  - `shell.openPath()`로 생성된 `.txt` 파일 열기

### 고려사항
- Gemini `inlineData`는 단일 요청 최대 **20MB** — 2번 작업의 분할 기준(19MB)과 정합
- `gemini-2.0-flash`는 비용 효율적이고 한국어 STT 품질이 양호 — 모델 변경 시 설정에서 선택 가능하도록 확장 여지 확보
- 배치 변환 시 동시 API 호출은 **2개 이하**로 제한 (Rate limit: 무료 티어 기준 분당 15 RPM)
- API 키는 메인 프로세스에서만 사용 — 렌더러에 노출하지 않음 (보안)
- 변환 결과 텍스트의 품질은 음원 품질에 의존 — UI에 "AI 변환 결과이므로 오류가 있을 수 있습니다" 안내 표시
- 오프라인 환경에서는 변환 불가 — 네트워크 상태 체크 후 안내
