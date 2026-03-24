import { ipcMain, shell } from 'electron';
import { existsSync } from 'fs';
import { IPC } from '../../shared/channels';
import type { DownloadRecord, DownloadRecordWithStatus } from '../../shared/types';
import { loadHistory, addRecord, updateTranscription, removeRecord } from '../services/history';

export function registerHistoryHandlers(): void {
  ipcMain.handle(IPC.GET_HISTORY, () => {
    const records = loadHistory();
    const withStatus: DownloadRecordWithStatus[] = records.map((r) => ({
      ...r,
      fileExists: existsSync(r.filePath),
      txtExists: r.txtPath ? existsSync(r.txtPath) : false,
      summaryExists: r.summaryPath ? existsSync(r.summaryPath) : false
    }));
    return { success: true, records: withStatus };
  });

  ipcMain.handle(IPC.ADD_HISTORY, (_event, record: DownloadRecord) => {
    addRecord(record);
    return { success: true };
  });

  ipcMain.handle(
    IPC.UPDATE_HISTORY_TRANSCRIPTION,
    (_event, contentId: string, txtPath: string, summaryPath?: string) => {
      updateTranscription(contentId, txtPath, summaryPath);
      return { success: true };
    }
  );

  ipcMain.handle(IPC.REMOVE_HISTORY, (_event, contentId: string) => {
    removeRecord(contentId);
    return { success: true };
  });

  ipcMain.handle(IPC.SHOW_IN_FOLDER, (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
    return { success: true };
  });
}
