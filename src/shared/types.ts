/** Canvas LMS 수강 강좌 */
export interface CourseItem {
  id: string;
  name: string; // Canvas shortName
  term: string; // 학기 (예: "2026-1학기")
}

export type GeminiModelId =
  | 'gemini-3.1-pro'
  | 'gemini-3-flash'
  | 'gemini-3.1-flash-lite'
  | 'gemini-2.5-flash'
  | 'gemini-2.5-flash-lite'
  | 'gemini-2.0-flash';

export interface GeminiModelOption {
  id: GeminiModelId;
  label: string;
  description: string;
}

/** Canvas LMS 영상 콘텐츠 메타데이터 */
export interface VideoItem {
  title: string;
  contentId: string; // commons.ssu.ac.kr content_id (다운로드 키)
  duration: number; // 초 단위
  fileSize: number; // 바이트 단위
  thumbnailUrl: string;
  weekPosition: number; // 주차 (모듈 내 위치)
  available: boolean; // content_id가 유효한지 (not_open 등은 false)
}

export interface WikiPageItem {
  title: string;
  courseId: string;
  weekPosition: number;
  available: boolean;
  url: string;
  files: WikiPageFileItem[];
}

export interface WikiPageFileItem {
  title: string;
  downloadUrl: string;
  apiEndpoint?: string;
}

export interface MarkdownFileItem {
  name: string;
  filePath: string;
  relativePath: string;
  updatedAt: string;
  size: number;
}

export interface WikiFileHistoryRecord {
  downloadUrl: string;
  title: string;
  filePath: string;
  downloadedAt: string; // ISO 8601
  summaryPath?: string;
}

export interface WikiFileHistoryRecordWithStatus extends WikiFileHistoryRecord {
  fileExists: boolean;
  summaryExists: boolean;
}
/** 다운로드/변환 요청용 최소 참조 (contentId + title만 필요) */
export interface VideoRef {
  contentId: string;
  title: string;
}

/** 다운로드 요청 시 히스토리 기록에 필요한 메타데이터 */
export interface DownloadMeta {
  courseId: string;
  courseName: string;
}

/** 히스토리 기록용 확장 비디오 참조 */
export interface VideoRefWithMeta extends VideoRef {
  fileSize: number;
  duration: number;
}

/** download-progress 이벤트 페이로드 (Main → Renderer) */
export interface DownloadProgressData {
  contentId: string;
  downloaded: number; // 수신된 바이트
  total: number; // Content-Length (0이면 알 수 없음)
  percent: number; // 0~100. MP3 시: 0-90 다운로드, 92-95 변환, 96-100 분할
  status?: 'converting' | 'splitting' | 'split-done' | 'done';
  splitCurrent?: number; // 현재 분할 중인 파트 번호
  splitTotal?: number; // 총 분할 파트 수
  batchCompleted?: number; // 일괄 다운로드 완료 개수
  batchTotal?: number; // 일괄 다운로드 전체 개수
}

/** 다운로드 히스토리 레코드 */
export interface DownloadRecord {
  contentId: string;
  title: string;
  courseId: string;
  courseName: string;
  filePath: string;
  format: 'mp4' | 'mp3';
  fileSize: number;
  duration: number;
  downloadedAt: string; // ISO 8601
  txtPath?: string;
  summaryPath?: string;
}

/** 렌더러에 반환될 때 파일 존재 여부 포함 */
export interface DownloadRecordWithStatus extends DownloadRecord {
  fileExists: boolean;
  txtExists: boolean;
  summaryExists: boolean;
}

/** transcribe-progress 이벤트 페이로드 (Main → Renderer) */
export interface TranscribeProgressData {
  fileName: string;
  percent: number; // 0~100. 0-90 변환, 95 병합, 100 완료
  status: 'converting' | 'uploading' | 'transcribing' | 'merging' | 'done' | 'error';
  currentPart?: number; // 분할 파일 중 현재 파트 번호
  totalParts?: number; // 분할 파일 총 파트 수
  currentFile?: number; // 일괄 변환 시 현재 파일 번호
  totalFiles?: number; // 일괄 변환 시 총 파일 수
  batchCompleted?: number; // 일괄 변환 완료 개수
  batchTotal?: number; // 일괄 변환 전체 개수
}
