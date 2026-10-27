/** ipcMain.handle / ipcRenderer.invoke 채널명 */
export const IPC = {
  OPEN_LOGIN: 'open-login',
  FETCH_COURSES: 'fetch-courses',
  FETCH_MODULES: 'fetch-modules',
  DOWNLOAD_VIDEO: 'download-video',
  DOWNLOAD_ALL: 'download-all',
  DOWNLOAD_WIKI_FILE: 'download-wiki-file',
  SUMMARIZE_WIKI_PDF: 'summarize-wiki-pdf',
  SET_GEMINI_API_KEY: 'set-gemini-api-key',
  GET_GEMINI_API_KEY: 'get-gemini-api-key',
  DELETE_GEMINI_API_KEY: 'delete-gemini-api-key',
  SET_GEMINI_MODEL: 'set-gemini-model',
  GET_GEMINI_MODEL: 'get-gemini-model',
  SET_TRANSCRIBE_ENGINE: 'set-transcribe-engine',
  GET_TRANSCRIBE_ENGINE: 'get-transcribe-engine',
  TRANSCRIBE_AUDIO: 'transcribe-audio',
  TRANSCRIBE_BATCH: 'transcribe-batch',
  DOWNLOAD_AND_TRANSCRIBE_ALL: 'download-and-transcribe-all',
  OPEN_FILE: 'open-file',
  SELECT_FOLDER: 'select-folder',
  SELECT_DOWNLOAD_FOLDER: 'select-download-folder',
  CHECK_FOR_UPDATE: 'check-for-update',
  INSTALL_UPDATE: 'install-update',
  GET_HISTORY: 'get-history',
  ADD_HISTORY: 'add-history',
  UPDATE_HISTORY_TRANSCRIPTION: 'update-history-transcription',
  REMOVE_HISTORY: 'remove-history',
  SHOW_IN_FOLDER: 'show-in-folder',
  GET_WIKI_FILE_HISTORY: 'get-wiki-file-history',
  ADD_WIKI_FILE_HISTORY: 'add-wiki-file-history',
  UPDATE_WIKI_FILE_SUMMARY: 'update-wiki-file-summary'
} as const;

/** ipcMain.send / ipcRenderer.on 이벤트 채널명 */
export const IPC_EVENT = {
  DOWNLOAD_PROGRESS: 'download-progress',
  TRANSCRIBE_PROGRESS: 'transcribe-progress',
  /** 자동 업데이트 상태 변경 (Main → Renderer) */
  UPDATE_STATUS: 'update-status',
  /** Whisper 전사 작업 요청 (Main → Renderer) */
  WHISPER_JOB: 'whisper-job',
  /** Whisper 전사 진행률/결과 (Renderer → Main, ipcRenderer.send / ipcMain.on) */
  WHISPER_JOB_RESULT: 'whisper-job-result'
} as const;
