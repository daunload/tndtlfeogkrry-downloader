import { randomUUID } from 'crypto';
import { ipcMain } from 'electron';
import { IPC_EVENT } from '../../shared/channels';
import { WHISPER_IPC_CHUNK_SAMPLES, WHISPER_IDLE_TIMEOUT_MS } from '../../shared/config';
import type { WhisperJobMessage, WhisperJobResult } from '../../shared/types';
import { decodeToPcm16k } from './media';

/**
 * 로컬 Whisper 전사 브리지.
 * 모델은 renderer의 Web Worker(transformers.js + WebGPU)에서 실행되므로,
 * main은 ffmpeg로 16kHz PCM을 디코딩해 renderer로 보내고 결과를 기다린다.
 */

/** 재시도/다음 파일 진행이 의미 없는 오류 (모델 로드 실패, 창 종료 등) */
export class WhisperFatalError extends Error {}

export interface WhisperProgress {
  stage: 'loading-model' | 'transcribing';
  percent: number; // 0~100
}

interface PendingJob {
  sender: Electron.WebContents;
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  onProgress: (progress: WhisperProgress) => void;
}

const pendingJobs = new Map<string, PendingJob>();
let isListening = false;

function ensureResultListener(): void {
  if (isListening) return;
  isListening = true;

  ipcMain.on(IPC_EVENT.WHISPER_JOB_RESULT, (event, result: WhisperJobResult) => {
    const job = pendingJobs.get(result.jobId);
    if (!job || event.sender !== job.sender) return;

    switch (result.type) {
      case 'model-progress':
        job.onProgress({ stage: 'loading-model', percent: result.percent });
        break;
      case 'progress':
        job.onProgress({ stage: 'transcribing', percent: result.percent });
        break;
      case 'done':
        job.resolve(result.text);
        break;
      case 'error':
        job.reject(
          result.fatal ? new WhisperFatalError(result.message) : new Error(result.message)
        );
        break;
    }
  });
}

// GPU 메모리를 공유하므로 동시에 하나의 작업만 실행한다
let queue: Promise<unknown> = Promise.resolve();

/** 오디오/비디오 파일을 로컬 Whisper로 전사한다. 호출 순서대로 하나씩 처리된다. */
export function transcribeWithWhisper(
  sender: Electron.WebContents,
  filePath: string,
  onProgress: (progress: WhisperProgress) => void
): Promise<string> {
  const run = queue.then(() => runJob(sender, filePath, onProgress));
  queue = run.catch(() => {});
  return run;
}

async function runJob(
  sender: Electron.WebContents,
  filePath: string,
  onProgress: (progress: WhisperProgress) => void
): Promise<string> {
  ensureResultListener();

  let pcm: Int16Array;
  try {
    pcm = await decodeToPcm16k(filePath);
  } catch (err) {
    throw new Error(`오디오 디코딩에 실패했습니다: ${(err as Error).message}`);
  }
  if (pcm.length === 0) return '';

  if (sender.isDestroyed()) {
    throw new WhisperFatalError('앱 화면이 닫혀 텍스트 변환을 진행할 수 없습니다.');
  }

  const jobId = randomUUID();

  return new Promise<string>((resolve, reject) => {
    // 렌더러가 종료/새로고침되면 Worker도 사라지므로 작업을 실패 처리
    const onRendererGone = (): void => {
      cleanup();
      reject(new WhisperFatalError('앱 화면이 다시 로드되어 텍스트 변환이 중단되었습니다.'));
    };
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = (): void => {
      clearTimeout(timer);
      pendingJobs.delete(jobId);
      if (!sender.isDestroyed()) {
        sender.off('render-process-gone', onRendererGone);
        sender.off('did-start-loading', onRendererGone);
      }
      sender.off('destroyed', onRendererGone);
    };

    const refreshTimeout = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        cleanup();
        try {
          if (!sender.isDestroyed()) sender.send(IPC_EVENT.WHISPER_JOB, { type: 'cancel', jobId });
        } catch (err) {
          console.warn('[whisper] Worker 중단 메시지 전송 실패', err);
        } finally {
          reject(
            new WhisperFatalError(
              'Whisper에서 15분 동안 진행 응답이 없어 중단했습니다. 다시 시도해주세요.'
            )
          );
        }
      }, WHISPER_IDLE_TIMEOUT_MS);
    };
    pendingJobs.set(jobId, {
      sender,
      resolve: (text) => {
        cleanup();
        resolve(text);
      },
      reject: (err) => {
        cleanup();
        reject(err);
      },
      onProgress: (progress) => {
        refreshTimeout();
        onProgress(progress);
      }
    });
    sender.on('render-process-gone', onRendererGone);
    sender.on('did-start-loading', onRendererGone);
    sender.on('destroyed', onRendererGone);

    const send = (message: WhisperJobMessage): void => sender.send(IPC_EVENT.WHISPER_JOB, message);

    refreshTimeout();
    try {
      send({ type: 'start', jobId, totalSamples: pcm.length });
      for (let offset = 0; offset < pcm.length; offset += WHISPER_IPC_CHUNK_SAMPLES) {
        // subarray는 structured clone 시 원본 버퍼 전체가 복사되므로 slice로 잘라 보낸다
        send({
          type: 'chunk',
          jobId,
          offset,
          samples: pcm.slice(offset, offset + WHISPER_IPC_CHUNK_SAMPLES)
        });
      }
      send({ type: 'run', jobId });
    } catch (err) {
      cleanup();
      reject(new WhisperFatalError(`Whisper 작업 전송 실패: ${String(err)}`));
    }
  });
}
