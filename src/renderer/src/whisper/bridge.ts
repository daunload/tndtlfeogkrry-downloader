import type { WhisperJobResult } from '../../../shared/types';
import type { WhisperWorkerRequest } from './whisper.worker';

/**
 * Main → Renderer로 전달되는 Whisper 작업을 받아 Web Worker에서 실행하고 결과를 main으로 돌려준다.
 * main에서 Int16 PCM 청크로 나눠 보내므로 여기서 Float32로 변환하며 조립한다.
 */

let worker: Worker | null = null;
const activeJobs = new Set<string>();
const pendingAudio = new Map<string, Float32Array>();

function resetWorker(): void {
  if (worker) {
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    worker = null;
  }
}

function failJobs(message: string): void {
  resetWorker();
  for (const jobId of activeJobs) {
    pendingAudio.delete(jobId);
    window.api.sendWhisperJobResult({ type: 'error', jobId, message, fatal: true });
  }
  activeJobs.clear();
}

function getWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<WhisperJobResult>): void => {
    if (!activeJobs.has(event.data.jobId)) return;
    if (event.data.type === 'done' || event.data.type === 'error') {
      activeJobs.delete(event.data.jobId);
    }
    window.api.sendWhisperJobResult(event.data);
  };
  worker.onerror = (event): void => {
    event.preventDefault();
    failJobs(`Whisper 실행 중 오류가 발생했습니다: ${event.message || 'Worker 실행 실패'}`);
  };
  worker.onmessageerror = () => failJobs('Whisper 결과를 읽지 못했습니다. 다시 시도해주세요.');
  return worker;
}

export function initWhisperBridge(): void {
  window.api.onWhisperJob((message) => {
    try {
      switch (message.type) {
        case 'cancel':
          pendingAudio.delete(message.jobId);
          if (activeJobs.delete(message.jobId)) resetWorker();
          break;
        case 'start':
          activeJobs.add(message.jobId);
          pendingAudio.set(message.jobId, new Float32Array(message.totalSamples));
          break;
        case 'chunk': {
          const audio = pendingAudio.get(message.jobId);
          if (!audio) return;
          const { samples, offset } = message;
          for (let i = 0; i < samples.length; i++) {
            audio[offset + i] = samples[i] / 32768;
          }
          break;
        }
        case 'run': {
          const audio = pendingAudio.get(message.jobId);
          pendingAudio.delete(message.jobId);
          if (!audio) {
            activeJobs.delete(message.jobId);
            window.api.sendWhisperJobResult({
              type: 'error',
              jobId: message.jobId,
              message: '오디오 데이터를 받지 못했습니다.',
              fatal: false
            });
            return;
          }
          const request: WhisperWorkerRequest = { jobId: message.jobId, audio };
          getWorker().postMessage(request, [audio.buffer]);
          break;
        }
      }
    } catch (err) {
      failJobs(`Whisper 작업을 시작하지 못했습니다: ${String(err)}`);
    }
  });
}
