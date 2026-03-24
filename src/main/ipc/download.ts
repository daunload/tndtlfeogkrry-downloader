import { BrowserWindow, ipcMain, dialog } from 'electron';
import { resolve } from 'path';
import { IPC, IPC_EVENT } from '../../shared/channels';
import { MAX_CONCURRENT_DOWNLOADS, toSafeFileName } from '../../shared/config';
import type { DownloadMeta, VideoRefWithMeta } from '../../shared/types';
import { downloadOne } from '../services/download';
import { addRecord } from '../services/history';

export function registerDownloadHandlers(): void {
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
