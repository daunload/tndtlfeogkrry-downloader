import {
  env,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
  type ProgressInfo
} from '@huggingface/transformers';
import { WHISPER_MODEL_ID, WHISPER_SAMPLE_RATE } from '../../../shared/config';
import type { WhisperJobResult } from '../../../shared/types';

/**
 * transformers.js로 Whisper를 실행하는 Web Worker.
 * 모델은 첫 실행 시 Hugging Face Hub에서 내려받아 브라우저 Cache Storage에 저장된다.
 */

export interface WhisperWorkerRequest {
  jobId: string;
  audio: Float32Array; // 16kHz 모노
}

// file:// 환경에서 /models/ 로컬 경로 조회를 시도하지 않도록 Hub에서만 로드
env.allowLocalModels = false;

// transformers.js는 기본으로 ORT wasm을 jsdelivr CDN에서 받는다.
// 경로 지정을 해제하면 Vite가 번들한 로컬 wasm을 사용하므로 오프라인에서도 동작한다.
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = undefined;
}

const CHUNK_LENGTH_S = 30;
const STRIDE_LENGTH_S = 5;

let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
/** 모델 다운로드 진행률을 보고할 작업 ID */
let loadingJobId = '';
let forceWasm = false;
let activeDevice: 'webgpu' | 'wasm' = 'wasm';

// tsconfig.web은 DOM lib 기준이라 Worker 전역의 postMessage 시그니처로 캐스팅
const workerScope = self as unknown as { postMessage: (message: WhisperJobResult) => void };

function post(result: WhisperJobResult): void {
  workerScope.postMessage(result);
}

interface GpuAdapterLike {
  features: { has: (feature: string) => boolean };
}

/** WebGPU가 가능하면 GPU(fp16 인코더), 아니면 CPU(WASM, 8bit 양자화)로 실행 */
async function selectBackend(): Promise<{
  device: 'webgpu' | 'wasm';
  dtype: Record<string, 'fp16' | 'q4' | 'q8'>;
}> {
  if (forceWasm)
    return { device: 'wasm', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' } };
  const gpu = (
    navigator as Navigator & { gpu?: { requestAdapter: () => Promise<GpuAdapterLike | null> } }
  ).gpu;
  const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null;

  if (adapter) {
    // 인코더는 양자화에 민감하므로 가능하면 fp16 유지, 디코더는 q4로 용량 절감
    const hasF16 = adapter.features.has('shader-f16');
    return {
      device: 'webgpu',
      dtype: { encoder_model: hasF16 ? 'fp16' : 'q4', decoder_model_merged: 'q4' }
    };
  }
  return { device: 'wasm', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' } };
}

function getTranscriber(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (transcriberPromise) return transcriberPromise;

  // progress_total은 큰 파일의 마지막 진행률이 누락돼 100%에 못 미치므로,
  // 파일별 진행률을 직접 모으고 'done' 시점에 해당 파일을 완료 처리한다
  const files = new Map<string, { loaded: number; total: number }>();
  let lastProgressAt = 0;
  const onProgress = (info: ProgressInfo): void => {
    if (info.status === 'progress') {
      files.set(info.file, { loaded: info.loaded, total: info.total });
    } else if (info.status === 'done') {
      const file = files.get(info.file);
      if (!file) return;
      file.loaded = file.total;
    } else {
      return;
    }

    let loaded = 0;
    let total = 0;
    for (const file of files.values()) {
      loaded += file.loaded;
      total += file.total;
    }
    const percent = total > 0 ? Math.floor((loaded / total) * 100) : 0;
    if (info.status !== 'done' && Date.now() - lastProgressAt < 1000) return;
    lastProgressAt = Date.now();
    post({ type: 'model-progress', jobId: loadingJobId, percent });
  };

  transcriberPromise = selectBackend().then(({ device, dtype }) => {
    activeDevice = device;
    return pipeline('automatic-speech-recognition', WHISPER_MODEL_ID, {
      device,
      dtype,
      progress_callback: onProgress
    }) as Promise<AutomaticSpeechRecognitionPipeline>;
  });
  // 실패 시 다음 요청에서 다시 시도할 수 있도록 초기화
  transcriberPromise.catch(() => {
    transcriberPromise = null;
  });
  return transcriberPromise;
}

/** 파이프라인이 오디오를 나누는 청크 수 (진행률 계산용, _call_whisper와 같은 방식) */
function countChunks(length: number): number {
  const window = WHISPER_SAMPLE_RATE * CHUNK_LENGTH_S;
  const jump = window - 2 * WHISPER_SAMPLE_RATE * STRIDE_LENGTH_S;
  if (length <= window) return 1;
  return 1 + Math.ceil((length - window) / jump);
}

async function retryOnCpu(request: WhisperWorkerRequest, err: unknown): Promise<boolean> {
  if (activeDevice !== 'webgpu' || forceWasm) return false;
  console.warn('[whisper] GPU 실행 실패, CPU로 재시도합니다.', err);
  forceWasm = true;
  const previous = transcriberPromise;
  transcriberPromise = null;
  if (previous) {
    try {
      await (await previous).dispose();
    } catch (disposeError) {
      console.warn('[whisper] GPU 모델 해제 실패', disposeError);
    }
  }
  post({ type: 'model-progress', jobId: request.jobId, percent: 0 });
  await handleJob(request);
  return true;
}

async function handleJob({ jobId, audio }: WhisperWorkerRequest): Promise<void> {
  let transcriber: AutomaticSpeechRecognitionPipeline;
  try {
    loadingJobId = jobId;
    post({ type: 'model-progress', jobId, percent: 0 });
    transcriber = await getTranscriber();
  } catch (err) {
    if (await retryOnCpu({ jobId, audio }, err)) return;
    console.error('[whisper]', err);
    post({
      type: 'error',
      jobId,
      message: `Whisper 모델을 불러오지 못했습니다: ${(err as Error).message}`,
      fatal: true
    });
    return;
  }

  const totalChunks = countChunks(audio.length);
  let doneChunks = 0;
  let lastTokenProgressAt = 0;
  post({ type: 'progress', jobId, percent: 0 });
  // generate() 1회(=청크 1개)가 끝날 때마다 end()가 호출된다
  const streamer = {
    put: (): void => {
      if (Date.now() - lastTokenProgressAt < 1000) return;
      lastTokenProgressAt = Date.now();
      post({
        type: 'progress',
        jobId,
        percent: Math.min(99, Math.round((doneChunks / totalChunks) * 100))
      });
    },
    end: (): void => {
      doneChunks++;
      post({
        type: 'progress',
        jobId,
        percent: Math.min(99, Math.round((doneChunks / totalChunks) * 100))
      });
    }
  };

  try {
    const output = await transcriber(audio, {
      language: 'korean',
      task: 'transcribe',
      chunk_length_s: CHUNK_LENGTH_S,
      stride_length_s: STRIDE_LENGTH_S,
      // @ts-expect-error streamer는 generate()로 그대로 전달되지만 파이프라인 타입에는 없음
      streamer
    });
    const text = Array.isArray(output) ? output.map((o) => o.text).join(' ') : output.text;
    post({ type: 'done', jobId, text });
  } catch (err) {
    if (await retryOnCpu({ jobId, audio }, err)) return;
    console.error('[whisper]', err);
    post({
      type: 'error',
      jobId,
      message: `Whisper 변환 실패: ${(err as Error).message}`,
      fatal: false
    });
  }
}

// 작업은 main에서 한 번에 하나씩만 보내지만, 혹시 겹치더라도 순서대로 처리
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<WhisperWorkerRequest>): void => {
  queue = queue
    .then(() => handleJob(event.data))
    .catch((err) => {
      post({
        type: 'error',
        jobId: event.data.jobId,
        message: `Whisper 실행 실패: ${String(err)}`,
        fatal: true
      });
    });
};
