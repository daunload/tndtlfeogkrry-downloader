import { BrowserWindow, ipcMain, dialog } from 'electron';
import { createWriteStream, writeFileSync } from 'fs';
import { unlink } from 'fs/promises';
import https from 'https';
import { resolve, basename, extname } from 'path';
import { IPC, IPC_EVENT } from '../../shared/channels';
import { MAX_CONCURRENT_DOWNLOADS, toSafeFileName } from '../../shared/config';
import type { DownloadMeta, VideoRefWithMeta } from '../../shared/types';
import { downloadOne } from '../services/download';
import { addRecord } from '../services/history';
import { getLmsSession } from '../window';
import {
  GeminiFatalError,
  loadGeminiApiKey,
  loadGeminiModel,
  summarizePdfWithRetry
} from '../services/gemini';

export function registerDownloadHandlers(): void {
  ipcMain.handle(
    IPC.DOWNLOAD_WIKI_FILE,
    async (event, downloadUrl: string, title: string, folderPath?: string) => {
      const mainWin = BrowserWindow.fromWebContents(event.sender);
      if (!mainWin) return { success: false, error: 'No window found' };

      const fallbackName = basename(new URL(downloadUrl).pathname) || 'downloaded-file';
      const safeName = toSafeFileName(title || fallbackName);
      let filePath: string;

      if (folderPath) {
        filePath = resolve(folderPath, safeName);
      } else {
        const saveResult = await dialog.showSaveDialog(mainWin, {
          defaultPath: safeName
        });

        if (saveResult.canceled || !saveResult.filePath) {
          return { success: false, error: 'cancelled' };
        }
        filePath = saveResult.filePath;
      }

      try {
        const lmsSession = getLmsSession();
        const cookies = await lmsSession.cookies.get({ url: downloadUrl });
        const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

        const downloadByHttps = (url: string): Promise<{ success: boolean; error?: string }> =>
          new Promise((resolveDownload) => {
            const req = https.get(
              url,
              {
                headers: {
                  ...(cookieHeader ? { Cookie: cookieHeader } : {}),
                  Referer: 'https://canvas.ssu.ac.kr/'
                }
              },
              (res) => {
                if (
                  res.statusCode &&
                  res.statusCode >= 300 &&
                  res.statusCode < 400 &&
                  res.headers.location
                ) {
                  res.resume();
                  const redirectUrl = new URL(res.headers.location, url).toString();
                  downloadByHttps(redirectUrl).then(resolveDownload);
                  return;
                }

                if (res.statusCode !== 200) {
                  res.resume();
                  resolveDownload({
                    success: false,
                    error: `수업자료 다운로드 실패: HTTP ${res.statusCode}`
                  });
                  return;
                }

                const fileStream = createWriteStream(filePath);
                res.pipe(fileStream);

                fileStream.on('finish', () => {
                  resolveDownload({ success: true });
                });

                fileStream.on('error', async (streamErr) => {
                  await unlink(filePath).catch(() => {});
                  resolveDownload({ success: false, error: (streamErr as Error).message });
                });

                res.on('error', async (resErr) => {
                  await unlink(filePath).catch(() => {});
                  resolveDownload({ success: false, error: (resErr as Error).message });
                });
              }
            );

            req.on('error', (reqErr) => {
              resolveDownload({ success: false, error: (reqErr as Error).message });
            });
          });

        const dl = await downloadByHttps(downloadUrl);
        if (!dl.success) return dl;
        return { success: true, filePath };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    }
  );

  ipcMain.handle(IPC.SUMMARIZE_WIKI_PDF, async (_event, filePath: string) => {
    const apiKey = loadGeminiApiKey();
    const geminiModel = loadGeminiModel();
    if (!apiKey) {
      return { success: false, error: 'Gemini API 키가 설정되지 않았습니다.' };
    }

    if (extname(filePath).toLowerCase() !== '.pdf') {
      return { success: false, error: 'PDF 파일만 요약할 수 있습니다.' };
    }

    try {
      const summaryText = await summarizePdfWithRetry(filePath, apiKey, geminiModel);
      const summaryPath = filePath.replace(/\.pdf$/i, '_요약본.md');
      writeFileSync(summaryPath, summaryText, 'utf-8');
      return { success: true, summaryPath };
    } catch (err) {
      // Gemini 관련 오류는 withRetry()가 사용자용 메시지로 변환해 둠
      if (err instanceof GeminiFatalError) {
        return { success: false, error: err.message };
      }
      return { success: false, error: `PDF 요약 실패: ${(err as Error).message}` };
    }
  });

  ipcMain.handle(
    IPC.DOWNLOAD_VIDEO,
    async (
      event,
      contentId: string,
      title: string,
      format: 'mp4' | 'mp3' = 'mp4',
      folderPath?: string,
      meta?: DownloadMeta & { fileSize: number; duration: number }
    ) => {
      const mainWin = BrowserWindow.fromWebContents(event.sender);
      if (!mainWin) return { success: false, error: 'No window found' };

      const safeName = toSafeFileName(title);
      const ext = format === 'mp3' ? 'mp3' : 'mp4';
      let filePath: string;

      if (folderPath) {
        filePath = resolve(folderPath, `${safeName}.${ext}`);
      } else {
        const filterName = format === 'mp3' ? 'Audio' : 'Video';
        const saveResult = await dialog.showSaveDialog(mainWin, {
          defaultPath: `${safeName}.${ext}`,
          filters: [{ name: filterName, extensions: [ext] }]
        });

        if (saveResult.canceled || !saveResult.filePath) {
          return { success: false, error: 'cancelled' };
        }
        filePath = saveResult.filePath;
      }

      const result = await downloadOne(contentId, filePath, event.sender, format);

      if (result.success && result.filePath && meta) {
        addRecord({
          contentId,
          title,
          courseId: meta.courseId,
          courseName: meta.courseName,
          filePath: result.filePath,
          format,
          fileSize: meta.fileSize,
          duration: meta.duration,
          downloadedAt: new Date().toISOString()
        });
      }

      return result;
    }
  );

  ipcMain.handle(
    IPC.DOWNLOAD_ALL,
    async (
      event,
      videos: VideoRefWithMeta[],
      format: 'mp4' | 'mp3' = 'mp4',
      folderPath?: string,
      meta?: DownloadMeta
    ) => {
      const mainWin = BrowserWindow.fromWebContents(event.sender);
      if (!mainWin) return { success: false, error: 'No window found' };

      let folder: string;

      if (folderPath) {
        folder = folderPath;
      } else {
        const folderResult = await dialog.showOpenDialog(mainWin, {
          properties: ['openDirectory', 'createDirectory'],
          title: '다운로드 폴더 선택'
        });

        if (folderResult.canceled || !folderResult.filePaths[0]) {
          return { success: false, error: 'cancelled' };
        }
        folder = folderResult.filePaths[0];
      }

      const ext = format === 'mp3' ? 'mp3' : 'mp4';
      const results: {
        title: string;
        contentId: string;
        success: boolean;
        error?: string;
        filePath?: string;
      }[] = new Array(videos.length);

      // Worker Pool 패턴: nextIndex를 공유 커서로 사용하여 동시성 제한
      let nextIndex = 0;
      let completedCount = 0;
      async function worker(): Promise<void> {
        while (nextIndex < videos.length) {
          const i = nextIndex++;
          const video = videos[i];
          const safeName = toSafeFileName(video.title);
          const filePath = resolve(folder, `${safeName}.${ext}`);
          const result = await downloadOne(video.contentId, filePath, event.sender, format);
          results[i] = {
            title: video.title,
            contentId: video.contentId,
            success: result.success,
            error: result.error,
            filePath: result.filePath
          };

          if (result.success && result.filePath && meta) {
            addRecord({
              contentId: video.contentId,
              title: video.title,
              courseId: meta.courseId,
              courseName: meta.courseName,
              filePath: result.filePath,
              format,
              fileSize: video.fileSize,
              duration: video.duration,
              downloadedAt: new Date().toISOString()
            });
          }

          completedCount++;
          event.sender.send(IPC_EVENT.DOWNLOAD_PROGRESS, {
            contentId: video.contentId,
            downloaded: 0,
            total: 0,
            percent: result.success ? 100 : -1,
            batchCompleted: completedCount,
            batchTotal: videos.length
          });
        }
      }

      const workers = Array.from(
        { length: Math.min(MAX_CONCURRENT_DOWNLOADS, videos.length) },
        () => worker()
      );
      await Promise.all(workers);

      const successCount = results.filter((r) => r.success).length;
      return { success: true, results, successCount, total: videos.length };
    }
  );
}
