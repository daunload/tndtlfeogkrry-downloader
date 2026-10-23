import type {
  GeminiModelId,
  GeminiModelOption,
  TranscribeEngine,
  TranscribeEngineOption
} from './types';

/** Electron session partition for LMS login */
export const LMS_SESSION_PARTITION = 'persist:lms';

/** MP3 파일 분할 임계값 (19MB) */
export const SPLIT_THRESHOLD_BYTES = 19 * 1024 * 1024;

/** 동시 다운로드 최대 개수 */
export const MAX_CONCURRENT_DOWNLOADS = 3;

/** 동시 텍스트 변환 최대 개수 */
export const MAX_CONCURRENT_TRANSCRIPTIONS = 2;

export const DEFAULT_GEMINI_MODEL: GeminiModelId = 'gemini-3.1-flash-lite';

// gemini-2.0-flash 계열은 2026-06-01 종료됨. 저장된 모델이 목록에 없으면 loadGeminiModel()이 기본값으로 대체한다.
export const GEMINI_MODEL_OPTIONS: GeminiModelOption[] = [
  {
    id: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro (Preview)',
    description: '고급 지능, 복잡한 문제 해결, 강력한 에이전트 및 분위기 코딩 기능'
  },
  {
    id: 'gemini-3-flash-preview',
    label: 'Gemini 3 Flash (Preview)',
    description: '더 큰 모델에 필적하는 프런티어급 성능을 훨씬 저렴한 비용으로 제공'
  },
  {
    id: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash-Lite (기본)',
    description: '프런티어급 성능을 더 낮은 비용으로 제공하는 빠른 경량 모델'
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    description: '짧은 지연 시간과 대용량 작업에 적합한 모델 (기존 사용 계정만 이용 가능)'
  },
  {
    id: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash-Lite',
    description: '2.5 계열에서 가장 빠르고 저렴한 모델 (기존 사용 계정만 이용 가능)'
  }
];

export const DEFAULT_TRANSCRIBE_ENGINE: TranscribeEngine = 'gemini';

export const TRANSCRIBE_ENGINE_OPTIONS: TranscribeEngineOption[] = [
  {
    id: 'gemini',
    label: 'Gemini API',
    description: 'Google Gemini로 변환합니다. API 키가 필요하며 빠르고 PC 사양과 무관합니다.'
  },
  {
    id: 'whisper',
    label: 'Whisper (로컬)',
    description:
      'PC에서 직접 변환합니다(whisper-large-v3-turbo). API 키 없이 무료로 동작하며, 첫 실행 시 모델(약 1.6GB)을 내려받습니다. 요약본 생성에는 Gemini API 키가 필요합니다.'
  }
];

/** 로컬 Whisper 모델 (Hugging Face Hub, transformers.js ONNX 변환본) */
export const WHISPER_MODEL_ID = 'onnx-community/whisper-large-v3-turbo';

/** Whisper 입력 샘플레이트 (16kHz 모노) */
export const WHISPER_SAMPLE_RATE = 16_000;

/** Main → Renderer PCM 전송 청크 크기 (샘플 수, Int16 기준 ~16MB). Chromium IPC 메시지 크기 제한 회피용 */
export const WHISPER_IPC_CHUNK_SAMPLES = 8 * 1024 * 1024;

/** Gemini API 재시도 최대 횟수 */
export const GEMINI_MAX_RETRIES = 3;

/** 다운로드 타임아웃 (5분) */
export const DOWNLOAD_TIMEOUT_MS = 300_000;

/** macOS 파일시스템 최대 파일명 바이트 수 */
const MAX_FILENAME_BYTES = 255;

/**
 * 비디오 제목에서 안전한 파일명을 생성한다.
 * 특수문자 제거 + macOS HFS+의 한글 NFD 변환 시 255바이트 제한 초과를 방지한다.
 * @param reserveBytes 확장자/접미사용 예약 바이트 수 (예: `_part99.mp3` = 12)
 */
export function toSafeFileName(title: string, reserveBytes: number = 12): string {
  let name = title.replace(/[/\\?%*:|"<>]/g, '_');
  const limit = MAX_FILENAME_BYTES - reserveBytes;

  // NFD 바이트 길이가 제한 이하가 될 때까지 뒤에서 한 글자씩 제거
  while (nfdByteLength(name) > limit) {
    name = name.slice(0, -1);
  }

  return name;
}

function nfdByteLength(str: string): number {
  const nfd = str.normalize('NFD');
  // TextEncoder.encode().length로 UTF-8 바이트 수 계산
  let bytes = 0;
  for (let i = 0; i < nfd.length; i++) {
    const code = nfd.charCodeAt(i);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

/** GitHub 리포지토리 (업데이트 확인용) */
export const GITHUB_REPO = 'daunload/tndtlfeogkrry-downloader';

export function isGeminiModel(model: string): model is GeminiModelId {
  return GEMINI_MODEL_OPTIONS.some((option) => option.id === model);
}

export function isTranscribeEngine(engine: string): engine is TranscribeEngine {
  return engine === 'gemini' || engine === 'whisper';
}

/** 진행 응답이 없는 작업의 대기 한도. CPU 추론 시간을 고려해 15분 허용. */
export const WHISPER_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
