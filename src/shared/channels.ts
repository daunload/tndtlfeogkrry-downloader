/** ipcMain.handle / ipcRenderer.invoke 채널명 */
export const IPC = {
  OPEN_LOGIN: 'open-login',
  FETCH_COURSES: 'fetch-courses',
  FETCH_MODULES: 'fetch-modules',
  DOWNLOAD_VIDEO: 'download-video',
  DOWNLOAD_ALL: 'download-all',
  SET_GEMINI_API_KEY: 'set-gemini-api-key',
  GET_GEMINI_API_KEY: 'get-gemini-api-key',
  DELETE_GEMINI_API_KEY: 'delete-gemini-api-key',
  SET_GEMINI_MODEL: 'set-gemini-model',
  GET_GEMINI_MODEL: 'get-gemini-model',
  TRANSCRIBE_AUDIO: 'transcribe-audio',
  TRANSCRIBE_BATCH: 'transcribe-batch',
  DOWNLOAD_AND_TRANSCRIBE_ALL: 'download-and-transcribe-all',
  OPEN_FILE: 'open-file',
  SELECT_FOLDER: 'select-folder',
  SELECT_DOWNLOAD_FOLDER: 'select-download-folder',
  CHECK_FOR_UPDATE: 'check-for-update',
  GET_HISTORY: 'get-history',
  ADD_HISTORY: 'add-history',
  UPDATE_HISTORY_TRANSCRIPTION: 'update-history-transcription',
  REMOVE_HISTORY: 'remove-history',
  SHOW_IN_FOLDER: 'show-in-folder'
} as const;

/** ipcMain.send / ipcRenderer.on 이벤트 채널명 */
export const IPC_EVENT = {
  DOWNLOAD_PROGRESS: 'download-progress',
  TRANSCRIBE_PROGRESS: 'transcribe-progress'
} as const;
