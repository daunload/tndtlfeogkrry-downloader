import { ElectronAPI } from '@electron-toolkit/preload';
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

interface DownloadApi {
  openLogin: () => Promise<{ success: boolean }>;
  fetchCourses: () => Promise<{
    success: boolean;
    error?: string;
    courses?: CourseItem[];
  }>;
  fetchModules: (courseId: string) => Promise<{
    success: boolean;
    error?: string;
    videos?: VideoItem[];
    wikiPages?: WikiPageItem[];
  }>;
  downloadVideo: (
    contentId: string,
    title: string,
    format?: 'mp4' | 'mp3',
    folderPath?: string,
    meta?: DownloadMeta & { fileSize: number; duration: number }
  ) => Promise<{ success: boolean; error?: string; filePath?: string }>;
  downloadWikiFile: (
    downloadUrl: string,
    title: string,
    folderPath?: string
  ) => Promise<{ success: boolean; error?: string; filePath?: string }>;
  summarizeWikiPdf: (
    filePath: string
  ) => Promise<{ success: boolean; error?: string; summaryPath?: string }>;
  downloadAll: (
    videos: VideoRefWithMeta[],
    format?: 'mp4' | 'mp3',
    folderPath?: string,
    meta?: DownloadMeta
  ) => Promise<{
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
  }>;
  onDownloadProgress: (callback: (data: DownloadProgressData) => void) => void;
  removeDownloadProgress: () => void;

  // Gemini STT
  setGeminiApiKey: (key: string) => Promise<{ success: boolean; error?: string }>;
  getGeminiApiKey: () => Promise<{ hasKey: boolean }>;
  deleteGeminiApiKey: () => Promise<{ success: boolean }>;
  getGeminiModel: () => Promise<{ model: GeminiModelId }>;
  setGeminiModel: (model: GeminiModelId) => Promise<{ success: boolean; error?: string }>;
  transcribeAudio: (
    filePath: string,
    withSummary?: boolean,
    useFileApi?: boolean
  ) => Promise<{ success: boolean; text?: string; txtPath?: string; error?: string }>;
  transcribeBatch: (
    dirPath: string,
    withSummary?: boolean,
    useFileApi?: boolean
  ) => Promise<{
    success: boolean;
    error?: string;
    results?: { fileName: string; success: boolean; error?: string }[];
    successCount?: number;
    total?: number;
  }>;
  openFile: (filePath: string) => Promise<{ success: boolean }>;
  selectFolder: () => Promise<{ success: boolean; folderPath?: string }>;
  selectDownloadFolder: () => Promise<{ success: boolean; folderPath?: string }>;
  selectMarkdownFolder: () => Promise<{ success: boolean; folderPath?: string }>;
  listMarkdownFiles: (
    folderPath: string
  ) => Promise<{ success: boolean; files?: MarkdownFileItem[]; error?: string }>;
  readMarkdownFile: (
    filePath: string
  ) => Promise<{ success: boolean; content?: string; error?: string }>;
  downloadAndTranscribeAll: (
    videos: VideoRefWithMeta[],
    folderPath?: string,
    withSummary?: boolean,
    useFileApi?: boolean,
    meta?: DownloadMeta
  ) => Promise<{
    success: boolean;
    error?: string;
    downloadSuccessCount?: number;
    transcribeSuccessCount?: number;
    total?: number;
  }>;
  onTranscribeProgress: (callback: (data: TranscribeProgressData) => void) => void;
  removeTranscribeProgress: () => void;
  checkForUpdate: () => Promise<{
    hasUpdate: boolean;
    currentVersion: string;
    latestVersion?: string;
    downloadUrl?: string;
  }>;

  // History
  getHistory: () => Promise<{ success: boolean; records?: DownloadRecordWithStatus[] }>;
  addHistory: (record: DownloadRecord) => Promise<{ success: boolean }>;
  updateHistoryTranscription: (
    contentId: string,
    txtPath: string,
    summaryPath?: string
  ) => Promise<{ success: boolean }>;
  removeHistory: (contentId: string) => Promise<{ success: boolean }>;
  showInFolder: (filePath: string) => Promise<{ success: boolean }>;
  getWikiFileHistory: () => Promise<{
    success: boolean;
    records?: WikiFileHistoryRecordWithStatus[];
  }>;
  addWikiFileHistory: (record: WikiFileHistoryRecord) => Promise<{ success: boolean }>;
  updateWikiFileSummary: (
    downloadUrl: string,
    summaryPath: string
  ) => Promise<{ success: boolean }>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    api: DownloadApi;
  }
}
