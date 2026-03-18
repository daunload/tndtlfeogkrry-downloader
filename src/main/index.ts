import { app, shell, BrowserWindow, ipcMain, dialog, session, safeStorage } from 'electron';
import { basename, dirname, extname, join, resolve } from 'path';
import { createWriteStream, statSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { unlink } from 'fs/promises';
import https from 'https';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import icon from '../../resources/icon.png?asset';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { XMLParser } from 'fast-xml-parser';
import { GoogleGenerativeAI } from '@google/generative-ai';

// asar 패키징 시 경로 보정
const ffmpegPath = ffmpegInstaller.path.replace('app.asar', 'app.asar.unpacked');
ffmpeg.setFfmpegPath(ffmpegPath);

const LMS_SESSION = 'persist:lms';

// --- Gemini API 키 관리 (safeStorage 암호화) ---
const API_KEY_FILE = join(app.getPath('userData'), 'gemini-key.enc');

function saveGeminiApiKey(key: string): void {
  const encrypted = safeStorage.encryptString(key);
  writeFileSync(API_KEY_FILE, encrypted);
}

function loadGeminiApiKey(): string | null {
  if (!existsSync(API_KEY_FILE)) return null;
  try {
    const encrypted = readFileSync(API_KEY_FILE);
    return safeStorage.decryptString(encrypted);
  } catch {
    return null;
  }
}

function deleteGeminiApiKey(): void {
  if (existsSync(API_KEY_FILE)) {
    writeFileSync(API_KEY_FILE, '');
  }
}

// --- Gemini 변환 로직 ---
async function transcribeOne(
  mp3Path: string,
  apiKey: string
): Promise<string> {
  const audioData = readFileSync(mp3Path);
  const base64Audio = audioData.toString('base64');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: 'audio/mp3',
        data: base64Audio
      }
    },
    {
      text: '이 오디오의 내용을 한국어 텍스트로 정확하게 받아적어주세요. 강의 내용이므로 전문 용어를 정확히 표기하고, 문단을 적절히 나눠주세요.'
    }
  ]);

  return result.response.text();
}

async function transcribeWithRetry(
  mp3Path: string,
  apiKey: string,
  maxRetries: number = 3
): Promise<string> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await transcribeOne(mp3Path, apiKey);
    } catch (err) {
      const message = (err as Error).message || '';
      // Rate limit (429) → 지수 백오프 재시도
      if (message.includes('429') && attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 2000; // 2s, 4s, 8s
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error('최대 재시도 횟수 초과');
}

// 분할 파일 그룹핑: "제목_part1.mp3" → { "제목": ["제목_part1.mp3", "제목_part2.mp3", ...] }
function groupMp3Files(dirPath: string): Map<string, string[]> {
  const files = readdirSync(dirPath).filter((f) => f.endsWith('.mp3')).sort();
  const groups = new Map<string, string[]>();

  for (const file of files) {
    const partMatch = file.match(/^(.+)_part\d+\.mp3$/);
    const baseName = partMatch ? partMatch[1] : file.replace(/\.mp3$/, '');

    if (!groups.has(baseName)) {
      groups.set(baseName, []);
    }
    groups.get(baseName)!.push(join(dirPath, file));
  }

  return groups;
}

// 로그인 세션을 유지하는 단일 BrowserWindow (숨김/표시 전환)
let lmsWin: BrowserWindow | null = null;

function getLmsSession(): Electron.Session {
  return session.fromPartition(LMS_SESSION);
}

function getOrCreateLmsWin(): BrowserWindow {
  if (lmsWin && !lmsWin.isDestroyed()) {
    return lmsWin;
  }
  lmsWin = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    closable: true,
    titleBarStyle: 'default',
    webPreferences: {
      session: getLmsSession()
    }
  });
  // 닫기 버튼 누르면 파괴하지 않고 숨기기만 함
  lmsWin.on('close', (e) => {
    if (lmsWin && !lmsWin.isDestroyed()) {
      e.preventDefault();
      lmsWin.hide();
    }
  });
  return lmsWin;
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron');

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // 로그인 창 열기 (같은 BrowserWindow를 재사용, 숨김/표시)
  ipcMain.handle('open-login', async () => {
    const win = getOrCreateLmsWin();
    win.loadURL('https://canvas.ssu.ac.kr/login');
    win.show();
    win.focus();

    // 로그인 성공 시 대시보드로 이동하면 자동으로 숨김
    return new Promise<{ success: boolean }>((resolve) => {
      const onNavigate = (_event: Electron.Event, url: string): void => {
        if (
          url.includes('/dashboard') ||
          (url.includes('canvas.ssu.ac.kr') && !url.includes('/login') && !url.includes('sso'))
        ) {
          win.webContents.removeListener('did-navigate', onNavigate);
          win.hide();
          resolve({ success: true });
        }
      };
      win.webContents.on('did-navigate', onNavigate);

      // 유저가 창을 닫으면(숨기면) 수동 확인
      const onHide = (): void => {
        win.removeListener('hide', onHide);
        win.webContents.removeListener('did-navigate', onNavigate);
        // 현재 URL로 로그인 여부 판단
        const currentUrl = win.webContents.getURL();
        const loggedIn = currentUrl.includes('canvas.ssu.ac.kr') && !currentUrl.includes('/login');
        resolve({ success: loggedIn });
      };
      win.on('hide', onHide);
    });
  });

  // 수강 과목 조회 (dashboard_cards API)
  ipcMain.handle('fetch-courses', async () => {
    try {
      const win = getOrCreateLmsWin();
      const currentUrl = win.webContents.getURL();

      if (!currentUrl.includes('canvas.ssu.ac.kr') || currentUrl.includes('/login')) {
        throw new Error('로그인이 필요합니다. 다시 로그인해주세요.');
      }

      const courses = await win.webContents.executeJavaScript(`
        (async () => {
          const res = await fetch('/api/v1/dashboard/dashboard_cards', { credentials: 'include' });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const text = await res.text();
          return JSON.parse(text.replace(/^while\\(1\\);/, ''));
        })()
      `);

      return {
        success: true,
        courses: courses.map((c: { id: string; shortName: string; term: string }) => ({
          id: c.id,
          name: c.shortName,
          term: c.term
        }))
      };
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('401') || msg.includes('403')) {
        return { success: false, error: '로그인이 만료되었습니다. 다시 로그인해주세요.' };
      }
      return { success: false, error: msg };
    }
  });

  // 강의 목록 조회 (로그인된 페이지 컨텍스트에서 직접 fetch)
  ipcMain.handle('fetch-modules', async (_event, courseId: string) => {
    try {
      const win = getOrCreateLmsWin();
      const currentUrl = win.webContents.getURL();
      console.log('현재 lmsWin URL:', currentUrl);

      // 로그인된 페이지가 canvas가 아니면 이동
      if (!currentUrl.includes('canvas.ssu.ac.kr') || currentUrl.includes('/login')) {
        throw new Error('로그인이 필요합니다. 다시 로그인해주세요.');
      }

      // 페이지에서 사용 가능한 인증 정보 탐색
      const authInfo = await win.webContents.executeJavaScript(`
        (async () => {
          // Canvas ENV에서 토큰 확인
          const env = window.ENV || {};
          // 메타 태그에서 CSRF 토큰
          const csrfMeta = document.querySelector('meta[name="csrf-token"]')?.content;
          // 쿠키에서 토큰 추출
          const cookies = Object.fromEntries(document.cookie.split('; ').map(c => c.split('=')));
          return {
            csrfMeta,
            accessToken: env.access_token || env.api_token || null,
            envKeys: Object.keys(env).join(','),
            xnApiToken: cookies['xn_api_token'] || null,
            localStorageKeys: Object.keys(localStorage).join(','),
          };
        })()
      `);
      console.log('인증 정보:', JSON.stringify(authInfo, null, 2));

      const modules = await win.webContents.executeJavaScript(`
        (async () => {
          const url = 'https://canvas.ssu.ac.kr/learningx/api/v1/courses/${courseId}/modules?include_detail=true';

          // 1차: xn_api_token을 Bearer로
          const xnToken = document.cookie.match(/xn_api_token=([^;]+)/)?.[1];
          const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content
            || document.cookie.match(/_csrf_token=([^;]+)/)?.[1];

          const h = {
            'Accept': 'application/json',
          };
          if (xnToken) h['Authorization'] = 'Bearer ' + decodeURIComponent(xnToken);
          if (csrfToken) h['X-CSRF-Token'] = decodeURIComponent(csrfToken);

          const res = await fetch(url, { credentials: 'include', headers: h });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return await res.json();
        })()
      `);

      interface VideoItem {
        title: string;
        contentId: string;
        duration: number;
        fileSize: number;
        thumbnailUrl: string;
        weekPosition: number;
      }

      const videos: VideoItem[] = [];

      for (const mod of modules) {
        if (!mod.module_items) continue;
        for (const item of mod.module_items) {
          if (
            ['everlec', 'movie', 'video', 'mp4'].includes(
              item.content_data?.item_content_data?.content_type
            )
          ) {
            const data = item.content_data.item_content_data;
            if (data.content_id) {
              videos.push({
                title: item.title,
                contentId: data.content_id,
                duration: data.duration || 0,
                fileSize: data.total_file_size || 0,
                thumbnailUrl: data.thumbnail_url || '',
                weekPosition: item.content_data.week_position || 0
              });
            }
          }
        }
      }

      return { success: true, videos };
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('401') || msg.includes('403')) {
        return { success: false, error: '로그인이 만료되었습니다. 다시 로그인해주세요.' };
      }
      return { success: false, error: msg };
    }
  });

  // MP4 → MP3 변환
  function convertToMp3(mp4Path: string, mp3Path: string): Promise<void> {
    return new Promise((res, rej) => {
      ffmpeg(mp4Path)
        .noVideo()
        .audioCodec('libmp3lame')
        .audioQuality(2)
        .output(mp3Path)
        .on('end', () => res())
        .on('error', (err) => rej(err))
        .run();
    });
  }

  // MP3 파일의 오디오 길이(초) 조회
  function getAudioDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) return reject(err);
        resolve(metadata.format.duration || 0);
      });
    });
  }

  // 29MB 기준 MP3 파일 분할
  const SPLIT_THRESHOLD = 19 * 1024 * 1024; // 19MB

  async function splitMp3(
    mp3Path: string,
    contentId: string,
    sender: Electron.WebContents
  ): Promise<string[]> {
    const fileSize = statSync(mp3Path).size;
    if (fileSize <= SPLIT_THRESHOLD) return [mp3Path];

    const duration = await getAudioDuration(mp3Path);
    // 19MB 기준으로 분할 수 계산 (여유분 확보)
    const partCount = Math.ceil(fileSize / (19 * 1024 * 1024));
    const partDuration = duration / partCount;

    const dir = dirname(mp3Path);
    const name = basename(mp3Path, extname(mp3Path));
    const parts: string[] = [];

    for (let i = 0; i < partCount; i++) {
      const partPath = join(dir, `${name}_part${i + 1}.mp3`);
      const startTime = i * partDuration;

      sender.send('download-progress', {
        contentId,
        downloaded: i,
        total: partCount,
        percent: 96 + Math.round((i / partCount) * 4), // 96~100%
        status: `splitting`,
        splitCurrent: i + 1,
        splitTotal: partCount
      });

      await new Promise<void>((resolve, reject) => {
        ffmpeg(mp3Path)
          .setStartTime(startTime)
          .setDuration(partDuration)
          .audioCodec('copy')
          .output(partPath)
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .run();
      });

      parts.push(partPath);
    }

    // 분할 완료 후 원본 삭제
    await unlink(mp3Path);

    sender.send('download-progress', {
      contentId,
      downloaded: partCount,
      total: partCount,
      percent: 100,
      status: 'split-done',
      splitTotal: partCount
    });

    return parts;
  }

  const xmlParser = new XMLParser({ ignoreAttributes: true });

  // content.php XML에서 영상 URL 추출
  function extractMediaUrl(xml: string): string | null {
    const parsed = xmlParser.parse(xml);
    const content = parsed?.content;
    if (!content) return null;

    const playingInfo = content.content_playing_info;
    if (!playingInfo) return null;

    // 파일명 추출 (story_list 또는 직접)
    const story = playingInfo.story_list?.story;
    const fileName: string | undefined =
      story?.main_media_list?.main_media || playingInfo.main_media_list?.main_media;

    // media_uri 템플릿 추출 (service_root.media 또는 직접)
    const mediaUriRaw =
      content.service_root?.media?.media_uri || playingInfo.media_uri || content.media_uri;

    // [MEDIA_FILE] 치환 방식
    if (fileName && mediaUriRaw) {
      const template = Array.isArray(mediaUriRaw) ? mediaUriRaw[0] : mediaUriRaw;
      if (typeof template === 'string' && template.includes('[MEDIA_FILE]')) {
        return template.replace('[MEDIA_FILE]', fileName);
      }
    }

    // 직접 URL이 있는 경우
    if (mediaUriRaw) {
      if (
        typeof mediaUriRaw === 'string' &&
        mediaUriRaw.includes('.mp4') &&
        !mediaUriRaw.includes('[')
      ) {
        return mediaUriRaw;
      }
      if (Array.isArray(mediaUriRaw)) {
        const valid = mediaUriRaw.find((u: string) => u && u.includes('.mp4') && !u.includes('['));
        if (valid) return valid;
      }
    }

    // video1 등: main_media.desktop.html5.media_uri 경로
    const desktopUri = playingInfo.main_media?.desktop?.html5?.media_uri;
    if (desktopUri && typeof desktopUri === 'string' && desktopUri.includes('.mp4')) {
      return desktopUri;
    }

    // fallback: content_uri 기반 조합
    if (fileName) {
      const contentUri = playingInfo.content_uri;
      if (contentUri) {
        const base = String(contentUri).replace(/web_files$/, 'media_files');
        return base + '/' + fileName;
      }
    }

    return null;
  }

  // Node.js https로 파일 다운로드 (진행률 추적)
  function downloadFile(
    url: string,
    savePath: string,
    contentId: string,
    sender: Electron.WebContents,
    progressMultiplier: number = 100
  ): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const req = https.get(
        url,
        {
          headers: {
            Referer: 'https://commons.ssu.ac.kr/',
            Origin: 'https://commons.ssu.ac.kr'
          }
        },
        (res) => {
          // 리다이렉트 처리
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume();
            downloadFile(
              res.headers.location,
              savePath,
              contentId,
              sender,
              progressMultiplier
            ).then(resolve);
            return;
          }

          if (res.statusCode !== 200) {
            res.resume();
            resolve({ success: false, error: `다운로드 HTTP ${res.statusCode}` });
            return;
          }

          const total = Number(res.headers['content-length'] || 0);
          const fileStream = createWriteStream(savePath);
          let received = 0;

          res.on('data', (chunk: Buffer) => {
            received += chunk.length;
            if (total > 0) {
              sender.send('download-progress', {
                contentId,
                downloaded: received,
                total,
                percent: Math.round((received / total) * progressMultiplier)
              });
            }
          });

          res.pipe(fileStream);

          fileStream.on('finish', () => {
            console.log(`다운로드 완료: ${savePath}, ${received} bytes`);
            resolve({ success: true });
          });

          fileStream.on('error', (err) => {
            resolve({ success: false, error: `파일 쓰기 실패: ${err.message}` });
          });
        }
      );

      req.on('error', (err) => {
        resolve({ success: false, error: `다운로드 실패: ${err.message}` });
      });

      req.setTimeout(300000, () => {
        req.destroy();
        resolve({ success: false, error: '다운로드 타임아웃 (5분)' });
      });
    });
  }

  // 단일 비디오 다운로드 공통 로직
  async function downloadOne(
    contentId: string,
    filePath: string,
    sender: Electron.WebContents,
    format: 'mp4' | 'mp3' = 'mp4'
  ): Promise<{ success: boolean; error?: string; filePath?: string }> {
    try {
      // content.php API로 영상 URL 조회 (세션 쿠키 자동 포함)
      const contentApiUrl = `https://commons.ssu.ac.kr/viewer/ssplayer/uniplayer_support/content.php?content_id=${contentId}&_=${Date.now()}`;
      const lmsSession = getLmsSession();
      const response = await lmsSession.fetch(contentApiUrl, {
        headers: {
          Referer: 'https://commons.ssu.ac.kr/',
          Origin: 'https://commons.ssu.ac.kr'
        }
      });

      if (!response.ok) {
        throw new Error(`content.php HTTP ${response.status}`);
      }

      const xml = await response.text();
      console.log('content.php XML 원본:', xml);
      const mediaUrl = extractMediaUrl(xml);

      console.log('content.php 결과 - mediaUrl:', mediaUrl);

      if (!mediaUrl) {
        const m = xml.match(/<content_type>([^<]+)<\/content_type>/);
        throw new Error(`다운로드할 수 없는 콘텐츠 형식입니다 (${m?.[1] || '알 수 없음'})`);
      }

      console.log('비디오 URL:', mediaUrl);

      // 다운로드 (MP3인 경우 임시 MP4로 먼저 받고 변환)
      const actualSavePath = format === 'mp3' ? filePath.replace(/\.mp3$/, '.tmp.mp4') : filePath;
      const progressMultiplier = format === 'mp3' ? 90 : 100;

      const dlResult = await downloadFile(
        mediaUrl,
        actualSavePath,
        contentId,
        sender,
        progressMultiplier
      );

      if (!dlResult.success) {
        console.error(`다운로드 실패 [${contentId}]:`, dlResult.error);
        return dlResult;
      }

      // MP3 변환 + 20MB 초과 시 자동 분할
      if (format === 'mp3') {
        try {
          sender.send('download-progress', {
            contentId,
            downloaded: 0,
            total: 0,
            percent: 92,
            status: 'converting'
          });
          await convertToMp3(actualSavePath, filePath);
          await unlink(actualSavePath);
          sender.send('download-progress', {
            contentId,
            downloaded: 0,
            total: 0,
            percent: 95,
            status: 'converting'
          });

          // 20MB 초과 시 분할
          const parts = await splitMp3(filePath, contentId, sender);
          const wasSplit = parts.length > 1;

          sender.send('download-progress', {
            contentId,
            downloaded: 0,
            total: 0,
            percent: 100,
            status: wasSplit ? 'split-done' : 'done',
            splitTotal: wasSplit ? parts.length : undefined
          });
          return { success: true, filePath };
        } catch (err) {
          await unlink(actualSavePath).catch(() => {});
          return { success: false, error: `MP3 변환/분할 실패: ${(err as Error).message}` };
        }
      }

      return { success: true, filePath };
    } catch (err) {
      console.error(`downloadOne 에러 [${contentId}]:`, (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  }

  // 비디오 다운로드 (개별)
  ipcMain.handle(
    'download-video',
    async (event, contentId: string, title: string, format: 'mp4' | 'mp3' = 'mp4') => {
      const mainWin = BrowserWindow.fromWebContents(event.sender);
      if (!mainWin) return { success: false, error: 'No window found' };

      const safeName = title.replace(/[/\\?%*:|"<>]/g, '_');
      const ext = format === 'mp3' ? 'mp3' : 'mp4';
      const filterName = format === 'mp3' ? 'Audio' : 'Video';
      const saveResult = await dialog.showSaveDialog(mainWin, {
        defaultPath: `${safeName}.${ext}`,
        filters: [{ name: filterName, extensions: [ext] }]
      });

      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, error: 'cancelled' };
      }

      return downloadOne(contentId, saveResult.filePath, event.sender, format);
    }
  );

  // 동시 다운로드 개수 제한 (최대 3개)
  const MAX_CONCURRENT = 3;

  // 전체 다운로드 (병렬)
  ipcMain.handle(
    'download-all',
    async (
      event,
      videos: { contentId: string; title: string }[],
      format: 'mp4' | 'mp3' = 'mp4'
    ) => {
      const mainWin = BrowserWindow.fromWebContents(event.sender);
      if (!mainWin) return { success: false, error: 'No window found' };

      const folderResult = await dialog.showOpenDialog(mainWin, {
        properties: ['openDirectory', 'createDirectory'],
        title: '다운로드 폴더 선택'
      });

      if (folderResult.canceled || !folderResult.filePaths[0]) {
        return { success: false, error: 'cancelled' };
      }

      const ext = format === 'mp3' ? 'mp3' : 'mp4';
      const folder = folderResult.filePaths[0];
      const results: { title: string; success: boolean; error?: string }[] = new Array(
        videos.length
      );

      // 병렬 큐: 최대 MAX_CONCURRENT개 동시 다운로드
      let nextIndex = 0;
      async function worker(): Promise<void> {
        while (nextIndex < videos.length) {
          const i = nextIndex++;
          const video = videos[i];
          const safeName = video.title.replace(/[/\\?%*:|"<>]/g, '_');
          const filePath = resolve(folder, `${safeName}.${ext}`);
          const result = await downloadOne(video.contentId, filePath, event.sender, format);
          results[i] = { title: video.title, success: result.success, error: result.error };
        }
      }

      const workers = Array.from({ length: Math.min(MAX_CONCURRENT, videos.length) }, () =>
        worker()
      );
      await Promise.all(workers);

      const successCount = results.filter((r) => r.success).length;
      return { success: true, results, successCount, total: videos.length };
    }
  );

  // --- Gemini API 키 관리 핸들러 ---
  ipcMain.handle('set-gemini-api-key', async (_event, key: string) => {
    try {
      saveGeminiApiKey(key);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('get-gemini-api-key', async () => {
    return { hasKey: loadGeminiApiKey() !== null };
  });

  ipcMain.handle('delete-gemini-api-key', async () => {
    deleteGeminiApiKey();
    return { success: true };
  });

  // --- 텍스트 변환 핸들러 ---
  ipcMain.handle('transcribe-audio', async (event, filePath: string) => {
    const apiKey = loadGeminiApiKey();
    if (!apiKey) {
      return { success: false, error: 'Gemini API 키가 설정되지 않았습니다.' };
    }

    try {
      const dir = dirname(filePath);
      const name = basename(filePath, extname(filePath));

      // 분할 파일 감지: 원본 이름에서 _partN 패턴 확인
      const partMatch = name.match(/^(.+)_part\d+$/);
      const baseName = partMatch ? partMatch[1] : name;

      // 같은 원본의 분할 파일 찾기
      const allFiles = readdirSync(dir).filter((f) => f.endsWith('.mp3')).sort();
      const partFiles = allFiles
        .filter((f) => f.match(new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_part\\d+\\.mp3$`)))
        .map((f) => join(dir, f));

      const filesToTranscribe = partFiles.length > 0 ? partFiles : [filePath];
      const totalParts = filesToTranscribe.length;
      const texts: string[] = [];

      for (let i = 0; i < filesToTranscribe.length; i++) {
        event.sender.send('transcribe-progress', {
          fileName: basename(filePath),
          percent: Math.round((i / totalParts) * 90),
          status: 'transcribing',
          currentPart: i + 1,
          totalParts
        });

        const text = await transcribeWithRetry(filesToTranscribe[i], apiKey);
        texts.push(text);
      }

      // 병합
      event.sender.send('transcribe-progress', {
        fileName: basename(filePath),
        percent: 95,
        status: 'merging'
      });

      const mergedText = texts.join('\n\n');
      const txtPath = join(dir, `${baseName}.txt`);
      writeFileSync(txtPath, mergedText, 'utf-8');

      event.sender.send('transcribe-progress', {
        fileName: basename(filePath),
        percent: 100,
        status: 'done'
      });

      return { success: true, text: mergedText, txtPath };
    } catch (err) {
      const message = (err as Error).message;
      event.sender.send('transcribe-progress', {
        fileName: basename(filePath),
        percent: 0,
        status: 'error'
      });

      if (message.includes('401') || message.includes('403')) {
        return { success: false, error: 'API 키가 유효하지 않습니다. 설정에서 다시 입력해주세요.' };
      }
      return { success: false, error: message };
    }
  });

  ipcMain.handle('transcribe-batch', async (event, dirPath: string) => {
    const apiKey = loadGeminiApiKey();
    if (!apiKey) {
      return { success: false, error: 'Gemini API 키가 설정되지 않았습니다.' };
    }

    const key = apiKey; // TS narrowing을 클로저에서도 유지
    const groups = groupMp3Files(dirPath);
    const groupEntries = Array.from(groups.entries());
    const total = groupEntries.length;
    const results: { fileName: string; success: boolean; error?: string }[] = [];

    // 동시 2개 제한
    let nextIndex = 0;
    async function worker(): Promise<void> {
      while (nextIndex < groupEntries.length) {
        const i = nextIndex++;
        const [baseName, files] = groupEntries[i];
        const texts: string[] = [];

        try {
          for (let j = 0; j < files.length; j++) {
            event.sender.send('transcribe-progress', {
              fileName: `${baseName}.mp3`,
              percent: Math.round((j / files.length) * 90),
              status: 'transcribing',
              currentPart: j + 1,
              totalParts: files.length,
              currentFile: i + 1,
              totalFiles: total
            });

            const text = await transcribeWithRetry(files[j], key);
            texts.push(text);
          }

          const mergedText = texts.join('\n\n');
          const txtPath = join(dirPath, `${baseName}.txt`);
          writeFileSync(txtPath, mergedText, 'utf-8');

          event.sender.send('transcribe-progress', {
            fileName: `${baseName}.mp3`,
            percent: 100,
            status: 'done',
            currentFile: i + 1,
            totalFiles: total
          });

          results.push({ fileName: baseName, success: true });
        } catch (err) {
          event.sender.send('transcribe-progress', {
            fileName: `${baseName}.mp3`,
            percent: 0,
            status: 'error',
            currentFile: i + 1,
            totalFiles: total
          });
          results.push({ fileName: baseName, success: false, error: (err as Error).message });
        }
      }
    }

    const workers = Array.from({ length: Math.min(2, groupEntries.length) }, () => worker());
    await Promise.all(workers);

    const successCount = results.filter((r) => r.success).length;
    return { success: true, results, successCount, total };
  });

  // 전체 다운로드 + 텍스트 변환 (한번에)
  ipcMain.handle(
    'download-and-transcribe-all',
    async (event, videos: { contentId: string; title: string }[]) => {
      const apiKey = loadGeminiApiKey();
      if (!apiKey) {
        return { success: false, error: 'Gemini API 키가 설정되지 않았습니다.' };
      }

      const mainWin = BrowserWindow.fromWebContents(event.sender);
      if (!mainWin) return { success: false, error: 'No window found' };

      const folderResult = await dialog.showOpenDialog(mainWin, {
        properties: ['openDirectory', 'createDirectory'],
        title: '다운로드 및 변환 폴더 선택'
      });

      if (folderResult.canceled || !folderResult.filePaths[0]) {
        return { success: false, error: 'cancelled' };
      }

      const folder = folderResult.filePaths[0];
      const key = apiKey;

      // 1단계: 전체 MP3 다운로드
      const downloadResults: { title: string; success: boolean; error?: string }[] = new Array(
        videos.length
      );

      let nextDownloadIndex = 0;
      async function downloadWorker(): Promise<void> {
        while (nextDownloadIndex < videos.length) {
          const i = nextDownloadIndex++;
          const video = videos[i];
          const safeName = video.title.replace(/[/\\?%*:|"<>]/g, '_');
          const filePath = resolve(folder, `${safeName}.mp3`);
          const result = await downloadOne(video.contentId, filePath, event.sender, 'mp3');
          downloadResults[i] = { title: video.title, success: result.success, error: result.error };
        }
      }

      const downloadWorkers = Array.from(
        { length: Math.min(MAX_CONCURRENT, videos.length) },
        () => downloadWorker()
      );
      await Promise.all(downloadWorkers);

      const downloadSuccessCount = downloadResults.filter((r) => r.success).length;
      if (downloadSuccessCount === 0) {
        return { success: false, error: '모든 다운로드가 실패했습니다.' };
      }

      // 2단계: 다운로드된 MP3 파일 텍스트 변환
      const groups = groupMp3Files(folder);
      const groupEntries = Array.from(groups.entries());
      const total = groupEntries.length;
      const transcribeResults: { fileName: string; success: boolean; error?: string }[] = [];

      let nextTranscribeIndex = 0;
      async function transcribeWorker(): Promise<void> {
        while (nextTranscribeIndex < groupEntries.length) {
          const i = nextTranscribeIndex++;
          const [baseName, files] = groupEntries[i];
          const texts: string[] = [];

          try {
            for (let j = 0; j < files.length; j++) {
              event.sender.send('transcribe-progress', {
                fileName: `${baseName}.mp3`,
                percent: Math.round((j / files.length) * 90),
                status: 'transcribing',
                currentPart: j + 1,
                totalParts: files.length,
                currentFile: i + 1,
                totalFiles: total
              });

              const text = await transcribeWithRetry(files[j], key);
              texts.push(text);
            }

            const mergedText = texts.join('\n\n');
            const txtPath = join(folder, `${baseName}.txt`);
            writeFileSync(txtPath, mergedText, 'utf-8');

            event.sender.send('transcribe-progress', {
              fileName: `${baseName}.mp3`,
              percent: 100,
              status: 'done',
              currentFile: i + 1,
              totalFiles: total
            });

            transcribeResults.push({ fileName: baseName, success: true });
          } catch (err) {
            event.sender.send('transcribe-progress', {
              fileName: `${baseName}.mp3`,
              percent: 0,
              status: 'error',
              currentFile: i + 1,
              totalFiles: total
            });
            transcribeResults.push({
              fileName: baseName,
              success: false,
              error: (err as Error).message
            });
          }
        }
      }

      const transcribeWorkers = Array.from(
        { length: Math.min(2, groupEntries.length) },
        () => transcribeWorker()
      );
      await Promise.all(transcribeWorkers);

      const transcribeSuccessCount = transcribeResults.filter((r) => r.success).length;
      return {
        success: true,
        downloadResults,
        downloadSuccessCount,
        transcribeResults,
        transcribeSuccessCount,
        total
      };
    }
  );

  // 텍스트 파일 열기
  ipcMain.handle('open-file', async (_event, filePath: string) => {
    shell.openPath(filePath);
    return { success: true };
  });

  // 폴더 선택 다이얼로그 (변환 시 다운로드 폴더 선택)
  ipcMain.handle('select-folder', async (event) => {
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

  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// lmsWin은 숨김 처리만 하므로 앱 종료 시 명시적으로 파괴
app.on('before-quit', () => {
  if (lmsWin && !lmsWin.isDestroyed()) {
    lmsWin.removeAllListeners('close');
    lmsWin.destroy();
    lmsWin = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
