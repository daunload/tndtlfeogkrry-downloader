# IPC API 명세

> 모든 채널명은 `src/shared/channels.ts`에 상수로 정의되어 있다.
> 핸들러 구현은 `src/main/ipc/` 하위 파일에 위치한다.

## invoke/handle 채널 (요청-응답)

### `open-login` (`IPC.OPEN_LOGIN`)

Canvas LMS 로그인 창을 열고 로그인 결과를 반환한다.
**핸들러**: `ipc/auth.ts`

```typescript
// 요청: 파라미터 없음
// 응답:
{
  success: boolean;
}
```

### `fetch-courses` (`IPC.FETCH_COURSES`)

수강 중인 강좌 목록을 조회한다.
**핸들러**: `ipc/courses.ts`

```typescript
// 요청: 파라미터 없음
// 응답:
{
  success: boolean
  error?: string
  courses?: CourseItem[]  // shared/types.ts
}
```

### `fetch-modules` (`IPC.FETCH_MODULES`)

특정 강좌의 영상 목록을 조회한다.
**핸들러**: `ipc/courses.ts`

```typescript
// 요청:
courseId: string

// 응답:
{
  success: boolean
  error?: string
  videos?: VideoItem[]  // shared/types.ts
}
```

### `download-video` (`IPC.DOWNLOAD_VIDEO`)

단일 영상을 다운로드한다. 파일 저장 다이얼로그가 열린다.
**핸들러**: `ipc/download.ts`

```typescript
// 요청:
contentId: string
title: string
format: 'mp4' | 'mp3'  // 기본값: 'mp4'

// 응답:
{ success: boolean; error?: string; filePath?: string }
```

### `download-all` (`IPC.DOWNLOAD_ALL`)

전체 영상을 일괄 다운로드한다. 폴더 선택 다이얼로그가 열린다.
**핸들러**: `ipc/download.ts`

```typescript
// 요청:
videos: VideoRef[]       // shared/types.ts
format: 'mp4' | 'mp3'   // 기본값: 'mp4'

// 응답:
{
  success: boolean
  error?: string
  results?: { title: string; success: boolean; error?: string }[]
  successCount?: number
  total?: number
}
```

### `set-gemini-api-key` (`IPC.SET_GEMINI_API_KEY`)

Gemini API 키를 암호화하여 저장한다.
**핸들러**: `ipc/settings.ts`

```typescript
// 요청:
key: string

// 응답:
{ success: boolean; error?: string }
```

### `get-gemini-api-key` (`IPC.GET_GEMINI_API_KEY`)

Gemini API 키 존재 여부를 확인한다 (키 값은 반환하지 않음).
**핸들러**: `ipc/settings.ts`

```typescript
// 요청: 파라미터 없음
// 응답:
{
  hasKey: boolean;
}
```

### `delete-gemini-api-key` (`IPC.DELETE_GEMINI_API_KEY`)

저장된 Gemini API 키를 삭제한다.
**핸들러**: `ipc/settings.ts`

```typescript
// 요청: 파라미터 없음
// 응답:
{
  success: boolean;
}
```

### `transcribe-audio` (`IPC.TRANSCRIBE_AUDIO`)

단일 MP3 파일(또는 분할 파일 그룹)을 텍스트로 변환한다.
**핸들러**: `ipc/transcribe.ts`

```typescript
// 요청:
filePath: string          // MP3 파일 경로
withSummary?: boolean     // 요약본 생성 여부 (기본값: true)
useFileApi?: boolean      // Gemini File API 사용 여부 (기본값: false)

// 응답:
{
  success: boolean
  text?: string      // 변환된 텍스트
  txtPath?: string   // 저장된 txt 파일 경로
  error?: string
}
```

### `transcribe-batch` (`IPC.TRANSCRIBE_BATCH`)

폴더 내 모든 MP3 파일을 일괄 텍스트 변환한다.
**핸들러**: `ipc/transcribe.ts`

```typescript
// 요청:
dirPath: string           // MP3 파일이 있는 폴더 경로
withSummary?: boolean     // 요약본 생성 여부 (기본값: true)
useFileApi?: boolean      // Gemini File API 사용 여부 (기본값: false)

// 응답:
{
  success: boolean
  error?: string
  results?: { fileName: string; success: boolean; error?: string }[]
  successCount?: number
  total?: number
}
```

### `download-and-transcribe-all` (`IPC.DOWNLOAD_AND_TRANSCRIBE_ALL`)

전체 영상 다운로드(MP3) + 텍스트 변환을 한번에 수행한다.
**핸들러**: `ipc/transcribe.ts`

```typescript
// 요청:
videos: VideoRef[]        // shared/types.ts
folderPath?: string       // 다운로드 폴더 경로 (없으면 다이얼로그 표시)
withSummary?: boolean     // 요약본 생성 여부 (기본값: true)
useFileApi?: boolean      // Gemini File API 사용 여부 (기본값: false)

// 응답:
{
  success: boolean
  error?: string
  downloadSuccessCount?: number
  transcribeSuccessCount?: number
  total?: number
}
```

### `open-file` (`IPC.OPEN_FILE`)

네이티브 앱으로 파일을 연다.
**핸들러**: `ipc/settings.ts`

```typescript
// 요청:
filePath: string;

// 응답:
{
  success: boolean;
}
```

### `select-folder` (`IPC.SELECT_FOLDER`)

폴더 선택 다이얼로그를 열어 경로를 반환한다.
**핸들러**: `ipc/settings.ts`

```typescript
// 요청: 파라미터 없음
// 응답:
{ success: boolean; folderPath?: string }
```

---

## send/on 이벤트 (단방향, Main → Renderer)

### `download-progress` (`IPC_EVENT.DOWNLOAD_PROGRESS`)

다운로드/변환/분할 진행률을 실시간으로 전송한다.
**타입**: `DownloadProgressData` (`shared/types.ts`)

```typescript
{
  contentId: string
  downloaded: number
  total: number
  percent: number          // 0~100
  status?: 'converting'    // MP4→MP3 변환 중
         | 'splitting'     // 대용량 MP3 분할 중
         | 'split-done'    // 분할 완료
         | 'done'          // 전체 완료
  splitCurrent?: number    // 현재 분할 파트 번호
  splitTotal?: number      // 총 분할 파트 수
}
```

**진행률 구간**:

- `0~90%` (MP3) / `0~100%` (MP4): 다운로드 진행
- `92~95%`: MP3 변환 중 (`converting`)
- `96~100%`: MP3 분할 중 (`splitting`)

### `transcribe-progress` (`IPC_EVENT.TRANSCRIBE_PROGRESS`)

텍스트 변환 진행률을 실시간으로 전송한다.
**타입**: `TranscribeProgressData` (`shared/types.ts`)

```typescript
{
  fileName: string
  percent: number          // 0~100
  status: 'converting'    // MP4→MP3 변환 중
        | 'uploading'      // File API 업로드 중
        | 'transcribing'   // 텍스트 변환 중
        | 'merging'        // 분할 파일 텍스트 병합 중
        | 'done'           // 완료
        | 'error'          // 오류 발생
  currentPart?: number     // 현재 파트 번호
  totalParts?: number      // 총 파트 수
  currentFile?: number     // 일괄 변환 시 현재 파일 번호
  totalFiles?: number      // 일괄 변환 시 총 파일 수
}
```
