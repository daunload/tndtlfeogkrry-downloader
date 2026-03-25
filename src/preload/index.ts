import { contextBridge, ipcRenderer } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';
import { IPC, IPC_EVENT } from '../shared/channels';
import type {
  CourseItem,
  VideoItem,
  WikiPageItem,
  WikiFileHistoryRecord,
  WikiFileHistoryRecordWithStatus,
  VideoRefWithMeta,
  DownloadMeta,
  DownloadProgressData,
  TranscribeProgressData,
  GeminiModelId,
  DownloadRecord,
  DownloadRecordWithStatus,
  MarkdownFileItem
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
    wikiPages?: WikiPageItem[];
  }> => ipcRenderer.invoke(IPC.FETCH_MODULES, courseId),

  downloadVideo: (
    contentId: string,
    title: string,
    format?: 'mp4' | 'mp3',
    folderPath?: string,
    meta?: DownloadMeta & { fileSize: number; duration: number }
  ): Promise<{ success: boolean; error?: string; filePath?: string }> =>
    ipcRenderer.invoke(IPC.DOWNLOAD_VIDEO, contentId, title, format || 'mp4', folderPath, meta),

  downloadWikiFile: (
    downloadUrl: string,
    title: string,
    folderPath?: string
  ): Promise<{ success: boolean; error?: string; filePath?: string }> =>
    ipcRenderer.invoke(IPC.DOWNLOAD_WIKI_FILE, downloadUrl, title, folderPath),

  summarizeWikiPdf: (
    filePath: string
  ): Promise<{ success: boolean; error?: string; summaryPath?: string }> =>
    ipcRenderer.invoke(IPC.SUMMARIZE_WIKI_PDF, filePath),

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

  selectMarkdownFolder: (): Promise<{ success: boolean; folderPath?: string }> =>
    ipcRenderer.invoke(IPC.SELECT_MARKDOWN_FOLDER),

  listMarkdownFiles: (
    folderPath: string
  ): Promise<{ success: boolean; files?: MarkdownFileItem[]; error?: string }> =>
    ipcRenderer.invoke(IPC.LIST_MARKDOWN_FILES, folderPath),

  readMarkdownFile: (
    filePath: string
  ): Promise<{ success: boolean; content?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.READ_MARKDOWN_FILE, filePath),

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
    ipcRenderer.invoke(IPC.SHOW_IN_FOLDER, filePath),

  getWikiFileHistory: (): Promise<{
    success: boolean;
    records?: WikiFileHistoryRecordWithStatus[];
  }> => ipcRenderer.invoke(IPC.GET_WIKI_FILE_HISTORY),

  addWikiFileHistory: (record: WikiFileHistoryRecord): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC.ADD_WIKI_FILE_HISTORY, record),

  updateWikiFileSummary: (
    downloadUrl: string,
    summaryPath: string
  ): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC.UPDATE_WIKI_FILE_SUMMARY, downloadUrl, summaryPath)
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
