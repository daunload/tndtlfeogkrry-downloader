const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

export const api = {
  openLogin: () => invoke('open_login'),
  fetchCourses: () => invoke('fetch_courses'),
  fetchModules: (courseId) => invoke('fetch_modules', { courseId }),
  downloadVideo: (contentId, title, folderPath, format, meta) =>
    invoke('download_video', { contentId, title, folderPath, format, meta }),
  downloadAll: (videos, folderPath, format, meta) =>
    invoke('download_all', { videos, folderPath, format, meta }),
  transcribeAudio: (filePath, withSummary, useFileApi, apiKey, model) =>
    invoke('transcribe_audio', { filePath, withSummary, useFileApi, apiKey, model }),
  getGeminiModelOptions: () => invoke('get_gemini_model_options'),
  getHistory: () => invoke('get_history'),
  removeHistoryRecord: (contentId) => invoke('remove_history_record', { contentId }),
  downloadWikiFile: (downloadUrl, title, folderPath) =>
    invoke('download_wiki_file', { downloadUrl, title, folderPath }),
  summarizeWikiPdf: (pdfPath, apiKey, model) =>
    invoke('summarize_wiki_pdf', { pdfPath, apiKey, model }),
};

export const events = {
  onDownloadProgress: (cb) => listen('download-progress', (e) => cb(e.payload)),
  onTranscribeProgress: (cb) => listen('transcribe-progress', (e) => cb(e.payload)),
};

export async function selectFolder() {
  const { open } = window.__TAURI__.dialog;
  return await open({ directory: true, title: '폴더 선택' });
}
