import { contextBridge, ipcRenderer } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';
import { IPC, IPC_EVENT } from '../shared/channels';
import type {
  CourseItem,
  VideoItem,
  VideoRefWithMeta,
  DownloadMeta,
  DownloadProgressData,
  TranscribeProgressData,
  GeminiModelId,
  DownloadRecord,
  DownloadRecordWithStatus
} from '../shared/types';

const api = {
  openLogin: (): Promise<{ success: boolean }> => ipcRenderer.invoke(IPC.OPEN_LOGIN),

  fetchCourses: (): Promise<{
    success: boolean;
    error?: string;
    courses?: CourseItem[];
  }> => ipcRenderer.invoke(IPC.FETCH_COURSES),

  fetchModules: (
    courseId: string
  ): Promise<{
    success: boolean;
    error?: string;
    videos?: VideoItem[];
  }> => ipcRenderer.invoke(IPC.FETCH_MODULES, courseId),

  downloadVideo: (
    contentId: string,
    title: string,
    format?: 'mp4' | 'mp3',
    folderPath?: string,
    meta?: DownloadMeta & { fileSize: number; duration: number }
  ): Promise<{ success: boolean; error?: string; filePath?: string }> =>
    ipcRenderer.invoke(IPC.DOWNLOAD_VIDEO, contentId, title, format || 'mp4', folderPath, meta),

  downloadAll: (
    videos: VideoRefWithMeta[],
    format?: 'mp4' | 'mp3',
    folderPath?: string,
    meta?: DownloadMeta
  ): Promise<{
    success: boolean;
    error?: string;
    results?: {
      title: string;
      contentId: string;
      success: boolean;
      error?: string;
      filePath?: string;
    }[];
    successCount?: number;
    total?: number;
  }> => ipcRenderer.invoke(IPC.DOWNLOAD_ALL, videos, format || 'mp4', folderPath, meta),

  onDownloadProgress: (callback: (data: DownloadProgressData) => void): void => {
    ipcRenderer.on(IPC_EVENT.DOWNLOAD_PROGRESS, (_event, data) => callback(data));
  },

  removeDownloadProgress: (): void => {
    ipcRenderer.removeAllListeners(IPC_EVENT.DOWNLOAD_PROGRESS);
  },

  // --- Gemini STT ---
  setGeminiApiKey: (key: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.SET_GEMINI_API_KEY, key),

  getGeminiApiKey: (): Promise<{ hasKey: boolean }> => ipcRenderer.invoke(IPC.GET_GEMINI_API_KEY),

  deleteGeminiApiKey: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC.DELETE_GEMINI_API_KEY),

  getGeminiModel: (): Promise<{ model: GeminiModelId }> => ipcRenderer.invoke(IPC.GET_GEMINI_MODEL),

  setGeminiModel: (model: GeminiModelId): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.SET_GEMINI_MODEL, model),

  transcribeAudio: (
    filePath: string,
    withSummary?: boolean,
    useFileApi?: boolean
  ): Promise<{ success: boolean; text?: string; txtPath?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.TRANSCRIBE_AUDIO, filePath, withSummary ?? true, useFileApi ?? false),

  transcribeBatch: (
    dirPath: string,
    withSummary?: boolean,
    useFileApi?: boolean
  ): Promise<{
    success: boolean;
    error?: string;
    results?: { fileName: string; success: boolean; error?: string }[];
    successCount?: number;
    total?: number;
  }> => ipcRenderer.invoke(IPC.TRANSCRIBE_BATCH, dirPath, withSummary ?? true, useFileApi ?? false),

  openFile: (filePath: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC.OPEN_FILE, filePath),

  selectFolder: (): Promise<{ success: boolean; folderPath?: string }> =>
    ipcRenderer.invoke(IPC.SELECT_FOLDER),

  selectDownloadFolder: (): Promise<{ success: boolean; folderPath?: string }> =>
    ipcRenderer.invoke(IPC.SELECT_DOWNLOAD_FOLDER),

  downloadAndTranscribeAll: (
    videos: VideoRefWithMeta[],
    folderPath?: string,
    withSummary?: boolean,
    useFileApi?: boolean,
    meta?: DownloadMeta
  ): Promise<{
    success: boolean;
    error?: string;
    downloadSuccessCount?: number;
    transcribeSuccessCount?: number;
    total?: number;
  }> =>
    ipcRenderer.invoke(
      IPC.DOWNLOAD_AND_TRANSCRIBE_ALL,
      videos,
      folderPath,
      withSummary ?? true,
      useFileApi ?? false,
      meta
    ),

  onTranscribeProgress: (callback: (data: TranscribeProgressData) => void): void => {
    ipcRenderer.on(IPC_EVENT.TRANSCRIBE_PROGRESS, (_event, data) => callback(data));
  },

  removeTranscribeProgress: (): void => {
    ipcRenderer.removeAllListeners(IPC_EVENT.TRANSCRIBE_PROGRESS);
  },

  checkForUpdate: (): Promise<{
    hasUpdate: boolean;
    currentVersion: string;
    latestVersion?: string;
    downloadUrl?: string;
  }> => ipcRenderer.invoke(IPC.CHECK_FOR_UPDATE),

  // --- History ---
  getHistory: (): Promise<{ success: boolean; records?: DownloadRecordWithStatus[] }> =>
    ipcRenderer.invoke(IPC.GET_HISTORY),

  addHistory: (record: DownloadRecord): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC.ADD_HISTORY, record),

  updateHistoryTranscription: (
    contentId: string,
    txtPath: string,
    summaryPath?: string
  ): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC.UPDATE_HISTORY_TRANSCRIPTION, contentId, txtPath, summaryPath),

  removeHistory: (contentId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC.REMOVE_HISTORY, contentId),

  showInFolder: (filePath: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC.SHOW_IN_FOLDER, filePath)
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI);
    contextBridge.exposeInMainWorld('api', api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.api = api;
}
