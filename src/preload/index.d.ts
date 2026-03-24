import { ElectronAPI } from '@electron-toolkit/preload';
import type {
  CourseItem,
  VideoItem,
  VideoRef,
  DownloadProgressData,
  TranscribeProgressData
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
  }>;
  downloadVideo: (
    contentId: string,
    title: string,
    format?: 'mp4' | 'mp3',
    folderPath?: string
  ) => Promise<{ success: boolean; error?: string; filePath?: string }>;
  downloadAll: (
    videos: VideoRef[],
    format?: 'mp4' | 'mp3',
    folderPath?: string
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
  transcribeAudio: (
    filePath: string,
    withSummary?: boolean
  ) => Promise<{ success: boolean; text?: string; txtPath?: string; error?: string }>;
  transcribeBatch: (
    dirPath: string,
    withSummary?: boolean
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
  downloadAndTranscribeAll: (
    videos: VideoRef[],
    folderPath?: string,
    withSummary?: boolean
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
}

declare global {
  interface Window {
    electron: ElectronAPI;
    api: DownloadApi;
  }
}
