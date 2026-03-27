const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

function unwrap(promise) {
  return promise.then((result) => {
    if (!result.success) throw new Error(result.error || '알 수 없는 오류');
    return result.data;
  });
}

export const api = {
  openLogin: () => invoke('open_login'),
  fetchCourses: () => unwrap(invoke('fetch_courses')),
  fetchModules: (courseId) => unwrap(invoke('fetch_modules', { courseId })),
  downloadVideo: (contentId, title, folderPath, format, meta) =>
    unwrap(invoke('download_video', { contentId, title, folderPath, format, meta })),
  downloadAll: (videos, folderPath, format, meta) =>
    unwrap(invoke('download_all', { videos, folderPath, format, meta })),
  transcribeAudio: (filePath, withSummary, useFileApi, apiKey, model) =>
    unwrap(invoke('transcribe_audio', { filePath, withSummary, useFileApi, apiKey, model })),
  getGeminiModelOptions: () => unwrap(invoke('get_gemini_model_options')),
  getHistory: () => unwrap(invoke('get_history')),
  removeHistoryRecord: (contentId) => unwrap(invoke('remove_history_record', { contentId })),
  downloadWikiFile: (downloadUrl, title, folderPath) =>
    unwrap(invoke('download_wiki_file', { downloadUrl, title, folderPath })),
  summarizeWikiPdf: (pdfPath, apiKey, model) =>
    unwrap(invoke('summarize_wiki_pdf', { pdfPath, apiKey, model })),
};

export const events = {
  onDownloadProgress: (cb) => listen('download-progress', (e) => cb(e.payload)),
  onTranscribeProgress: (cb) => listen('transcribe-progress', (e) => cb(e.payload)),
};

export async function selectFolder() {
  const { open } = window.__TAURI__.dialog;
  return await open({ directory: true, title: '폴더 선택' });
}
