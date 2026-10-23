import { basename, dirname, extname, join } from 'path';
import { BrowserWindow, ipcMain, dialog } from 'electron';
import { existsSync, readdirSync, writeFileSync } from 'fs';
import { unlink } from 'fs/promises';
import { resolve } from 'path';
import { IPC } from '../../shared/channels';
import { IPC_EVENT } from '../../shared/channels';
import {
  MAX_CONCURRENT_DOWNLOADS,
  MAX_CONCURRENT_TRANSCRIPTIONS,
  toSafeFileName
} from '../../shared/config';
import type {
  DownloadMeta,
  GeminiModelId,
  TranscribeEngine,
  TranscribeProgressData,
  VideoRefWithMeta
} from '../../shared/types';
import {
  GeminiFatalError,
  loadGeminiApiKey,
  loadGeminiModel,
  summarizeWithRetry,
  verifyGemini
} from '../services/gemini';
import { transcribeWithRetry, groupMp3Files } from '../services/gemini';
import { transcribeWithWhisper, WhisperFatalError } from '../services/whisper';
import { loadTranscribeEngine } from '../services/transcribeEngine';
import { downloadOne } from '../services/download';
import { convertToMp3, splitMp3 } from '../services/media';
import { addRecord, updateTranscription } from '../services/history';

/** 한 번의 변환 요청에 적용되는 엔진/옵션 */
interface TranscribeContext {
  engine: TranscribeEngine;
  apiKey: string | null;
  geminiModel: GeminiModelId;
  /** Gemini File API 사용 여부 (Whisper에서는 항상 false) */
  useFileApi: boolean;
  /** 요약본 생성 여부. 요약은 Gemini를 쓰므로 API 키가 있을 때만 true */
  withSummary: boolean;
  /** 동시 변환 개수. Whisper는 GPU를 공유하므로 1개씩 */
  concurrency: number;
}

/**
 * 저장된 엔진 설정으로 변환 컨텍스트를 만든다.
 * @param verify 오래 걸리는 일괄 작업 전에 Gemini 키/모델을 미리 확인할지 여부
 */
async function prepareContext(
  withSummary: boolean,
  useFileApi: boolean,
  verify: boolean
): Promise<{ ctx: TranscribeContext; error?: undefined } | { ctx?: undefined; error: string }> {
  const engine = loadTranscribeEngine();
  const apiKey = loadGeminiApiKey();
  const geminiModel = loadGeminiModel();

  if (engine === 'gemini' && !apiKey) {
    return { error: 'Gemini API 키가 설정되지 않았습니다.' };
  }

  const ctx: TranscribeContext = {
    engine,
    apiKey,
    geminiModel,
    useFileApi: engine === 'gemini' && useFileApi,
    withSummary: withSummary && apiKey !== null,
    concurrency: engine === 'whisper' ? 1 : MAX_CONCURRENT_TRANSCRIPTIONS
  };

  // 키/모델 문제를 파일마다 반복해서 겪지 않도록 시작 전에 한 번 확인
  const needsGemini = engine === 'gemini';
  if (verify && apiKey && needsGemini) {
    const verified = await verifyGemini(apiKey, geminiModel);
    if (!verified.ok) return { error: verified.error };
  }

  return { ctx };
}

function isFatalError(err: unknown): boolean {
  return err instanceof GeminiFatalError || err instanceof WhisperFatalError;
}

function sendProgress(sender: Electron.WebContents, data: TranscribeProgressData): void {
  sender.send(IPC_EVENT.TRANSCRIBE_PROGRESS, data);
}

/**
 * 분할 파트를 순서대로 변환하고 병합된 텍스트를 반환한다.
 * 진행률은 0~90% 구간을 파트 수로 나눠 보고한다.
 */
async function transcribeParts(
  sender: Electron.WebContents,
  ctx: TranscribeContext,
  files: string[],
  base: Pick<TranscribeProgressData, 'fileName' | 'currentFile' | 'totalFiles'>
): Promise<string> {
  const totalParts = files.length;
  const texts: string[] = [];

  for (let j = 0; j < totalParts; j++) {
    const part = { ...base, currentPart: j + 1, totalParts };

    if (ctx.engine === 'whisper') {
      sendProgress(sender, {
        ...part,
        percent: Math.round((j / totalParts) * 90),
        status: 'transcribing'
      });

      const text = await transcribeWithWhisper(sender, files[j], ({ stage, percent }) => {
        sendProgress(sender, {
          ...part,
          // 모델 로딩 중에는 모델 다운로드 진행률을 그대로 보여준다
          percent:
            stage === 'loading-model'
              ? percent
              : Math.round(((j + percent / 100) / totalParts) * 90),
          status: stage
        });
      });
      texts.push(text.trim());
      continue;
    }

    if (ctx.useFileApi) {
      sendProgress(sender, {
        ...part,
        percent: Math.round((j / totalParts) * 45),
        status: 'uploading'
      });
    }

    sendProgress(sender, {
      ...part,
      percent: Math.round(((ctx.useFileApi ? j + 0.5 : j) / totalParts) * 90),
      status: 'transcribing'
    });

    const text = await transcribeWithRetry(files[j], ctx.apiKey!, ctx.geminiModel, ctx.useFileApi);
    texts.push(text);
  }

  return texts.join('\n\n');
}

/** 요약 옵션이 켜져 있으면 요약본을 생성해 저장하고 경로를 반환한다. */
async function summarizeIfNeeded(
  ctx: TranscribeContext,
  text: string,
  dir: string,
  baseName: string
): Promise<{ summaryPath?: string; summaryError?: string }> {
  if (!ctx.withSummary || !ctx.apiKey) return {};

  try {
    const summary = await summarizeWithRetry(text, ctx.apiKey, ctx.geminiModel);
    const summaryPath = join(dir, `${baseName}_요약본.md`);
    writeFileSync(summaryPath, summary, 'utf-8');
    return { summaryPath };
  } catch (err) {
    return { summaryError: (err as Error).message };
  }
}

export function registerTranscribeHandlers(): void {
  ipcMain.handle(
    IPC.TRANSCRIBE_AUDIO,
    async (event, filePath: string, withSummary: boolean = true, useFileApi: boolean = false) => {
      const prepared = await prepareContext(withSummary, useFileApi, false);
      if (!prepared.ctx) {
        return { success: false, error: prepared.error };
      }
      const ctx = prepared.ctx;

      try {
        const dir = dirname(filePath);
        const ext = extname(filePath).toLowerCase();
        const name = basename(filePath, extname(filePath));
        const baseName = name.replace(/_part\d+$/, '');

        let mp3Path = filePath;
        let convertedFromMp4 = false;
        let filesToTranscribe: string[];

        if (ctx.engine === 'whisper' && ext === '.mp4') {
          // Whisper는 ffmpeg로 MP4에서 바로 오디오를 디코딩하므로 MP3 변환/분할이 필요 없다
          if (!existsSync(filePath)) {
            return { success: false, error: `파일을 찾을 수 없습니다: ${basename(filePath)}` };
          }
          filesToTranscribe = [filePath];
        } else {
          // mp4인 경우 mp3로 먼저 변환
          if (ext === '.mp4') {
            mp3Path = join(dir, `${name}.mp3`);

            if (!existsSync(mp3Path)) {
              sendProgress(event.sender, {
                fileName: basename(filePath),
                percent: 0,
                status: 'converting'
              });
              await convertToMp3(filePath, mp3Path);
              convertedFromMp4 = true;

              // File API는 대용량 파일을 지원하므로 분할 불필요
              if (!ctx.useFileApi) {
                await splitMp3(mp3Path, name, event.sender);
              }
            }
          }

          if (ctx.useFileApi) {
            // File API: 원본 MP3를 통째로 전송 (분할 불필요)
            if (!existsSync(mp3Path)) {
              return {
                success: false,
                error: `MP3 파일을 찾을 수 없습니다: ${basename(mp3Path)}. 먼저 MP3로 다운로드해주세요.`
              };
            }
            filesToTranscribe = [mp3Path];
          } else {
            // inlineData/Whisper: 분할 파일이 있으면 사용
            const allFiles = readdirSync(dir)
              .filter((f) => f.endsWith('.mp3'))
              .sort();
            const normalizedBaseName = baseName.normalize('NFC');
            const escapedBaseName = normalizedBaseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const partRegex = new RegExp(`^${escapedBaseName}_part\\d+\\.mp3$`);
            const partFiles = allFiles
              .filter((f) => partRegex.test(f.normalize('NFC')))
              .map((f) => join(dir, f));

            if (partFiles.length === 0 && !existsSync(mp3Path)) {
              return {
                success: false,
                error: `MP3 파일을 찾을 수 없습니다: ${basename(mp3Path)}. 먼저 MP3로 다운로드해주세요.`
              };
            }
            filesToTranscribe = partFiles.length > 0 ? partFiles : [mp3Path];
          }
        }

        const mergedText = await transcribeParts(event.sender, ctx, filesToTranscribe, {
          fileName: basename(filePath)
        });

        sendProgress(event.sender, {
          fileName: basename(filePath),
          percent: 95,
          status: 'merging'
        });

        const txtPath = join(dir, `${baseName}.txt`);
        writeFileSync(txtPath, mergedText, 'utf-8');

        const summary = await summarizeIfNeeded(ctx, mergedText, dir, baseName);

        // mp4에서 변환된 임시 mp3 파일 정리
        if (convertedFromMp4) {
          for (const f of filesToTranscribe) {
            await unlink(f).catch(() => {});
          }
        }

        sendProgress(event.sender, {
          fileName: basename(filePath),
          percent: 100,
          status: 'done'
        });

        return { success: true, text: mergedText, txtPath, ...summary };
      } catch (err) {
        const message = (err as Error).message;
        sendProgress(event.sender, {
          fileName: basename(filePath),
          percent: 0,
          status: 'error'
        });

        // withRetry()/Whisper 브리지가 이미 사용자용 메시지로 변환한 오류
        return { success: false, error: message };
      }
    }
  );

  ipcMain.handle(
    IPC.TRANSCRIBE_BATCH,
    async (event, dirPath: string, withSummary: boolean = true, useFileApi: boolean = false) => {
      const prepared = await prepareContext(withSummary, useFileApi, true);
      if (!prepared.ctx) {
        return { success: false, error: prepared.error };
      }
      const ctx = prepared.ctx;

      const groups = groupMp3Files(dirPath);
      const groupEntries = Array.from(groups.entries());
      const total = groupEntries.length;
      const results: {
        fileName: string;
        success: boolean;
        error?: string;
        summaryError?: string;
      }[] = [];

      let nextIndex = 0;
      let completedCount = 0;
      let fatalError: string | null = null;
      async function worker(): Promise<void> {
        while (nextIndex < groupEntries.length && !fatalError) {
          const i = nextIndex++;
          const [baseName, files] = groupEntries[i];

          try {
            const mergedText = await transcribeParts(event.sender, ctx, files, {
              fileName: `${baseName}.mp3`,
              currentFile: i + 1,
              totalFiles: total
            });

            const txtPath = join(dirPath, `${baseName}.txt`);
            writeFileSync(txtPath, mergedText, 'utf-8');

            const summary = await summarizeIfNeeded(ctx, mergedText, dirPath, baseName);

            completedCount++;
            sendProgress(event.sender, {
              fileName: `${baseName}.mp3`,
              percent: 100,
              status: 'done',
              currentFile: i + 1,
              totalFiles: total,
              batchCompleted: completedCount,
              batchTotal: total
            });

            results.push({ fileName: baseName, success: true, summaryError: summary.summaryError });
          } catch (err) {
            completedCount++;
            sendProgress(event.sender, {
              fileName: `${baseName}.mp3`,
              percent: 0,
              status: 'error',
              currentFile: i + 1,
              totalFiles: total,
              batchCompleted: completedCount,
              batchTotal: total
            });
            results.push({ fileName: baseName, success: false, error: (err as Error).message });
            if (isFatalError(err)) fatalError = (err as Error).message;
          }
        }
      }

      const workers = Array.from({ length: Math.min(ctx.concurrency, groupEntries.length) }, () =>
        worker()
      );
      await Promise.all(workers);

      const successCount = results.filter((r) => r.success).length;
      if (fatalError) {
        return { success: false, error: fatalError, results, successCount, total };
      }
      return { success: true, results, successCount, total };
    }
  );

  ipcMain.handle(
    IPC.DOWNLOAD_AND_TRANSCRIBE_ALL,
    async (
      event,
      videos: VideoRefWithMeta[],
      folderPath?: string,
      withSummary: boolean = true,
      useFileApi: boolean = false,
      meta?: DownloadMeta
    ) => {
      // 오래 걸리는 다운로드 전에 키/모델 사용 가능 여부를 먼저 확인
      const prepared = await prepareContext(withSummary, useFileApi, true);
      if (!prepared.ctx) {
        return { success: false, error: prepared.error };
      }
      const ctx = prepared.ctx;

      const mainWin = BrowserWindow.fromWebContents(event.sender);
      if (!mainWin) return { success: false, error: 'No window found' };

      let folder: string;

      if (folderPath) {
        folder = folderPath;
      } else {
        const folderResult = await dialog.showOpenDialog(mainWin, {
          properties: ['openDirectory', 'createDirectory'],
          title: '다운로드 및 변환 폴더 선택'
        });

        if (folderResult.canceled || !folderResult.filePaths[0]) {
          return { success: false, error: 'cancelled' };
        }
        folder = folderResult.filePaths[0];
      }

      // === 2단계 파이프라인 ===
      // 1단계: 전체 MP3 다운로드 (최대 MAX_CONCURRENT_DOWNLOADS개 병렬)
      const downloadResults: { title: string; success: boolean; error?: string }[] = new Array(
        videos.length
      );

      let nextDownloadIndex = 0;
      async function downloadWorker(): Promise<void> {
        while (nextDownloadIndex < videos.length) {
          const i = nextDownloadIndex++;
          const video = videos[i];
          const safeName = toSafeFileName(video.title);
          const filePath = resolve(folder, `${safeName}.mp3`);
          const result = await downloadOne(video.contentId, filePath, event.sender, 'mp3');
          downloadResults[i] = { title: video.title, success: result.success, error: result.error };

          if (result.success && meta) {
            addRecord({
              contentId: video.contentId,
              title: video.title,
              courseId: meta.courseId,
              courseName: meta.courseName,
              filePath,
              format: 'mp3',
              fileSize: video.fileSize,
              duration: video.duration,
              downloadedAt: new Date().toISOString()
            });
          }
        }
      }

      const downloadWorkers = Array.from(
        { length: Math.min(MAX_CONCURRENT_DOWNLOADS, videos.length) },
        () => downloadWorker()
      );
      await Promise.all(downloadWorkers);

      const downloadSuccessCount = downloadResults.filter((r) => r.success).length;
      if (downloadSuccessCount === 0) {
        return { success: false, error: '모든 다운로드가 실패했습니다.' };
      }

      // baseName → contentId 매핑 (히스토리 업데이트용)
      const baseNameToContentId = new Map<string, string>();
      for (const video of videos) {
        const safeName = toSafeFileName(video.title);
        baseNameToContentId.set(safeName, video.contentId);
      }

      // 2단계: 다운로드된 MP3 파일 텍스트 변환 (최대 ctx.concurrency개 병렬)
      const groups = groupMp3Files(folder);
      const groupEntries = Array.from(groups.entries());
      const total = groupEntries.length;
      const transcribeResults: {
        fileName: string;
        success: boolean;
        error?: string;
        summaryError?: string;
      }[] = [];

      let nextTranscribeIndex = 0;
      let transcribeCompletedCount = 0;
      let fatalError: string | null = null;
      async function transcribeWorker(): Promise<void> {
        while (nextTranscribeIndex < groupEntries.length && !fatalError) {
          const i = nextTranscribeIndex++;
          const [baseName, files] = groupEntries[i];

          try {
            const mergedText = await transcribeParts(event.sender, ctx, files, {
              fileName: `${baseName}.mp3`,
              currentFile: i + 1,
              totalFiles: total
            });

            const txtPath = join(folder, `${baseName}.txt`);
            writeFileSync(txtPath, mergedText, 'utf-8');

            const summary = await summarizeIfNeeded(ctx, mergedText, folder, baseName);

            // 히스토리에 텍스트 변환 경로 업데이트
            const cid = baseNameToContentId.get(baseName);
            if (cid) {
              updateTranscription(cid, txtPath, summary.summaryPath);
            }

            transcribeCompletedCount++;
            sendProgress(event.sender, {
              fileName: `${baseName}.mp3`,
              percent: 100,
              status: 'done',
              currentFile: i + 1,
              totalFiles: total,
              batchCompleted: transcribeCompletedCount,
              batchTotal: total
            });

            transcribeResults.push({
              fileName: baseName,
              success: true,
              summaryError: summary.summaryError
            });
          } catch (err) {
            transcribeCompletedCount++;
            sendProgress(event.sender, {
              fileName: `${baseName}.mp3`,
              percent: 0,
              status: 'error',
              currentFile: i + 1,
              totalFiles: total,
              batchCompleted: transcribeCompletedCount,
              batchTotal: total
            });
            transcribeResults.push({
              fileName: baseName,
              success: false,
              error: (err as Error).message
            });
            if (isFatalError(err)) fatalError = (err as Error).message;
          }
        }
      }

      const transcribeWorkers = Array.from(
        { length: Math.min(ctx.concurrency, groupEntries.length) },
        () => transcribeWorker()
      );
      await Promise.all(transcribeWorkers);

      const transcribeSuccessCount = transcribeResults.filter((r) => r.success).length;
      return {
        success: true,
        fatalError: fatalError ?? undefined,
        downloadResults,
        downloadSuccessCount,
        transcribeResults,
        transcribeSuccessCount,
        total
      };
    }
  );
}
