import { ipcMain } from 'electron';
import { IPC } from '../../shared/channels';
import { getOrCreateLmsWin } from '../window';

export function registerCoursesHandlers(): void {
  ipcMain.handle(IPC.FETCH_COURSES, async () => {
    try {
      const win = getOrCreateLmsWin();
      const currentUrl = win.webContents.getURL();

      if (!currentUrl.includes('canvas.ssu.ac.kr') || currentUrl.includes('/login')) {
        throw new Error('로그인이 필요합니다. 다시 로그인해주세요.');
      }

      // LMS 창 컨텍스트에서 Canvas API 호출 (세션 쿠키 자동 포함)
      // Canvas는 JSON 앞에 "while(1);" CSRF 프리픽스를 붙이므로 제거 필요
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

  ipcMain.handle(IPC.FETCH_MODULES, async (_event, courseId: string) => {
    try {
      const win = getOrCreateLmsWin();
      const currentUrl = win.webContents.getURL();
      console.log('현재 lmsWin URL:', currentUrl);

      if (!currentUrl.includes('canvas.ssu.ac.kr') || currentUrl.includes('/login')) {
        throw new Error('로그인이 필요합니다. 다시 로그인해주세요.');
      }

      // LearningX API는 xn_api_token(Bearer) + CSRF 토큰 조합으로 인증
      const authInfo = await win.webContents.executeJavaScript(`
        (async () => {
          const env = window.ENV || {};
          const csrfMeta = document.querySelector('meta[name="csrf-token"]')?.content;
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
          // 영상 콘텐츠만 필터링 (everlec=에버렉 녹화, movie/video/mp4=일반 영상)
          if (
            ['everlec', 'movie', 'video', 'mp4'].includes(
              item.content_data?.item_content_data?.content_type
            )
          ) {
            // 차주 강의가 미리 올라와 잠긴 케이스 처리
            const isLocked = item.content_data?.unlock_at
              ? new Date(item.content_data?.unlock_at) > new Date()
              : false;
            if (isLocked) continue;

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
}
