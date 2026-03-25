import { BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { readdir, readFile, stat } from 'fs/promises';
import { extname, join, relative } from 'path';
import { IPC } from '../../shared/channels';
import { isGeminiModel } from '../../shared/config';
import {
  saveGeminiApiKey,
  loadGeminiApiKey,
  deleteGeminiApiKey,
  saveGeminiModel,
  loadGeminiModel
} from '../services/gemini';
import type { GeminiModelId } from '../../shared/types';
import type { MarkdownFileItem } from '../../shared/types';

async function collectMarkdownFiles(rootDir: string): Promise<MarkdownFileItem[]> {
  const files: MarkdownFileItem[] = [];
  const queue: string[] = [rootDir];

  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir) continue;

    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const targetPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(targetPath);
        continue;
      }

      if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.md') {
        continue;
      }

      const fileStat = await stat(targetPath);
      files.push({
        name: entry.name,
        filePath: targetPath,
        relativePath: relative(rootDir, targetPath),
        updatedAt: fileStat.mtime.toISOString(),
        size: fileStat.size
      });
    }
  }

  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.SET_GEMINI_API_KEY, async (_event, key: string) => {
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

  ipcMain.handle(IPC.SELECT_MARKDOWN_FOLDER, async (event) => {
    const mainWin = BrowserWindow.fromWebContents(event.sender);
    if (!mainWin) return { success: false };

    const result = await dialog.showOpenDialog(mainWin, {
      properties: ['openDirectory'],
      title: 'Markdown 파일 폴더 선택'
    });

    if (result.canceled || !result.filePaths[0]) {
      return { success: false };
    }
    return { success: true, folderPath: result.filePaths[0] };
  });

  ipcMain.handle(IPC.LIST_MARKDOWN_FILES, async (_event, folderPath: string) => {
    try {
      const files = await collectMarkdownFiles(folderPath);
      return { success: true, files };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC.READ_MARKDOWN_FILE, async (_event, filePath: string) => {
    try {
      const content = await readFile(filePath, 'utf-8');
      return { success: true, content };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
