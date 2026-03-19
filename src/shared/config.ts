/** Electron session partition for LMS login */
export const LMS_SESSION_PARTITION = 'persist:lms'

/** MP3 파일 분할 임계값 (19MB) */
export const SPLIT_THRESHOLD_BYTES = 19 * 1024 * 1024

/** 동시 다운로드 최대 개수 */
export const MAX_CONCURRENT_DOWNLOADS = 3

/** 동시 텍스트 변환 최대 개수 */
export const MAX_CONCURRENT_TRANSCRIPTIONS = 2

/** Gemini 모델명 */
export const GEMINI_MODEL = 'gemini-2.0-flash'

/** Gemini API 재시도 최대 횟수 */
export const GEMINI_MAX_RETRIES = 3

/** 다운로드 타임아웃 (5분) */
export const DOWNLOAD_TIMEOUT_MS = 300_000

/** GitHub 리포지토리 (업데이트 확인용) */
export const GITHUB_REPO = 'daunload/tndtlfeogkrry-downloader'
