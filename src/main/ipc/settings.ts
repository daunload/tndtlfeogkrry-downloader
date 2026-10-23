import { BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { IPC } from '../../shared/channels';
import { isGeminiModel, isTranscribeEngine } from '../../shared/config';
import {
  saveGeminiApiKey,
  loadGeminiApiKey,
  deleteGeminiApiKey,
  saveGeminiModel,
  loadGeminiModel,
  verifyGemini
} from '../services/gemini';
import { loadTranscribeEngine, saveTranscribeEngine } from '../services/transcribeEngine';
import type { GeminiModelId, TranscribeEngine } from '../../shared/types';

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.SET_GEMINI_API_KEY, async (_event, key: string) => {
    // 저장 전에 실제로 사용 가능한 키인지 확인
    const verified = await verifyGemini(key);
    if (!verified.ok) {
      return { success: false, error: verified.error };
    }

    try {
      saveGeminiApiKey(key);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC.GET_GEMINI_API_KEY, async () => {
    return { hasKey: loadGeminiApiKey() !== null };
  });

  ipcMain.handle(IPC.DELETE_GEMINI_API_KEY, async () => {
    deleteGeminiApiKey();
    return { success: true };
  });

  ipcMain.handle(IPC.GET_GEMINI_MODEL, async () => {
    return { model: loadGeminiModel() };
  });

  ipcMain.handle(IPC.SET_GEMINI_MODEL, async (_event, model: GeminiModelId) => {
    if (!isGeminiModel(model)) {
      return { success: false, error: '지원하지 않는 Gemini 모델입니다.' };
    }

    try {
      saveGeminiModel(model);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC.GET_TRANSCRIBE_ENGINE, async () => {
    return { engine: loadTranscribeEngine() };
  });

  ipcMain.handle(IPC.SET_TRANSCRIBE_ENGINE, async (_event, engine: TranscribeEngine) => {
    if (!isTranscribeEngine(engine)) {
      return { success: false, error: '지원하지 않는 텍스트 변환 엔진입니다.' };
    }

    try {
      saveTranscribeEngine(engine);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC.OPEN_FILE, async (_event, filePath: string) => {
    shell.openPath(filePath);
    return { success: true };
  });

  ipcMain.handle(IPC.SELECT_DOWNLOAD_FOLDER, async (event) => {
    const mainWin = BrowserWindow.fromWebContents(event.sender);
    if (!mainWin) return { success: false };

    const result = await dialog.showOpenDialog(mainWin, {
      properties: ['openDirectory', 'createDirectory'],
      title: '다운로드 폴더 선택'
    });

    if (result.canceled || !result.filePaths[0]) {
      return { success: false };
    }
    return { success: true, folderPath: result.filePaths[0] };
  });

  ipcMain.handle(IPC.SELECT_FOLDER, async (event) => {
    const mainWin = BrowserWindow.fromWebContents(event.sender);
    if (!mainWin) return { success: false };

    const result = await dialog.showOpenDialog(mainWin, {
      properties: ['openDirectory'],
      title: 'MP3 파일이 있는 폴더 선택'
    });

    if (result.canceled || !result.filePaths[0]) {
      return { success: false };
    }
    return { success: true, folderPath: result.filePaths[0] };
  });
}
