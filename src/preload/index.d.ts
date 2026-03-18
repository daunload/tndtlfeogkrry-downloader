import { ElectronAPI } from '@electron-toolkit/preload'

interface VideoItem {
  title: string
  contentId: string
  duration: number
  fileSize: number
  thumbnailUrl: string
  weekPosition: number
}

interface CourseItem {
  id: string
  name: string
  term: string
}

interface DownloadApi {
  openLogin: () => Promise<{ success: boolean }>
  fetchCourses: () => Promise<{
    success: boolean
    error?: string
    courses?: CourseItem[]
  }>
  fetchModules: (courseId: string) => Promise<{
    success: boolean
    error?: string
    videos?: VideoItem[]
  }>
  downloadVideo: (
    contentId: string,
    title: string,
    format?: 'mp4' | 'mp3'
  ) => Promise<{ success: boolean; error?: string; filePath?: string }>
  downloadAll: (
    videos: { contentId: string; title: string }[],
    format?: 'mp4' | 'mp3'
  ) => Promise<{
    success: boolean
    error?: string
    results?: { title: string; success: boolean; error?: string }[]
    successCount?: number
    total?: number
  }>
  onDownloadProgress: (
    callback: (data: {
      contentId: string
      downloaded: number
      total: number
      percent: number
      status?: 'converting' | 'splitting' | 'split-done' | 'done'
      splitCurrent?: number
      splitTotal?: number
    }) => void
  ) => void
  removeDownloadProgress: () => void

  // Gemini STT
  setGeminiApiKey: (key: string) => Promise<{ success: boolean; error?: string }>
  getGeminiApiKey: () => Promise<{ hasKey: boolean }>
  deleteGeminiApiKey: () => Promise<{ success: boolean }>
  transcribeAudio: (
    filePath: string
  ) => Promise<{ success: boolean; text?: string; txtPath?: string; error?: string }>
  transcribeBatch: (dirPath: string) => Promise<{
    success: boolean
    error?: string
    results?: { fileName: string; success: boolean; error?: string }[]
    successCount?: number
    total?: number
  }>
  openFile: (filePath: string) => Promise<{ success: boolean }>
  selectFolder: () => Promise<{ success: boolean; folderPath?: string }>
  downloadAndTranscribeAll: (
    videos: { contentId: string; title: string }[]
  ) => Promise<{
    success: boolean
    error?: string
    downloadSuccessCount?: number
    transcribeSuccessCount?: number
    total?: number
  }>
  onTranscribeProgress: (
    callback: (data: {
      fileName: string
      percent: number
      status: 'transcribing' | 'merging' | 'done' | 'error'
      currentPart?: number
      totalParts?: number
      currentFile?: number
      totalFiles?: number
    }) => void
  ) => void
  removeTranscribeProgress: () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DownloadApi
  }
}
