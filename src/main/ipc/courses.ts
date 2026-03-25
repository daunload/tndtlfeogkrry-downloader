import { ipcMain } from 'electron';
import { IPC } from '../../shared/channels';
import { getLmsSession, getOrCreateLmsWin } from '../window';

const VIDEO_TYPES = ['everlec', 'movie', 'video', 'mp4'];

interface WikiPageFileItem {
  title: string;
  downloadUrl: string;
  apiEndpoint?: string;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function isPdfFile(title: string, downloadUrl: string): boolean {
  const lowerTitle = title.toLowerCase();
  const lowerPath = new URL(downloadUrl).pathname.toLowerCase();
  return lowerTitle.endsWith('.pdf') || lowerPath.endsWith('.pdf');
}

function extractWikiFilesFromHtml(html: string): WikiPageFileItem[] {
  const files: WikiPageFileItem[] = [];
  const anchorRegex =
    /<a\b[^>]*class=["'][^"']*instructure_file_link[^"']*["'][^>]*>[\s\S]*?<\/a>/gi;

  for (const anchor of html.match(anchorRegex) || []) {
    const titleMatch = anchor.match(/\btitle=(["'])(.*?)\1/i);
    const hrefMatch = anchor.match(/\bhref=(["'])(.*?)\1/i);
    const apiEndpointMatch = anchor.match(/\bdata-api-endpoint=(["'])(.*?)\1/i);
    const innerTextMatch = anchor.match(/>([\s\S]*?)<\/a>/i);

    const title = decodeHtml((titleMatch?.[2] || innerTextMatch?.[1] || '첨부파일').trim());
    const href = hrefMatch?.[2]?.trim();
    if (!href) continue;

    const downloadUrl = new URL(decodeHtml(href), 'https://canvas.ssu.ac.kr').toString();
    if (!isPdfFile(title, downloadUrl)) continue;

    files.push({
      title,
      downloadUrl,
      apiEndpoint: apiEndpointMatch?.[2] ? decodeHtml(apiEndpointMatch[2]) : undefined
    });
  }

  return files;
}

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
      if (!currentUrl.includes('canvas.ssu.ac.kr') || currentUrl.includes('/login')) {
        throw new Error('로그인이 필요합니다. 다시 로그인해주세요.');
      }

      const modules = await win.webContents.executeJavaScript(`
        (async () => {
          const url = 'https://canvas.ssu.ac.kr/learningx/api/v1/courses/${courseId}/modules?include_detail=true';

          const xnToken = document.cookie.match(/xn_api_token=([^;]+)/)?.[1];
          const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content
            || document.cookie.match(/_csrf_token=([^;]+)/)?.[1];

          const h = {
            'Accept': 'application/json',
          };
          // NOTE: Header 값은 ByteString(0~255) 제약이 있으므로 decodeURIComponent를 적용하지 않는다.
          if (xnToken) h['Authorization'] = 'Bearer ' + xnToken;
          if (csrfToken) h['X-CSRF-Token'] = csrfToken;

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
        available: boolean;
        isCompleted: boolean;
        isAbsent: boolean;
      }

      interface WikiPageItem {
        title: string;
        courseId: string;
        weekPosition: number;
        available: boolean;
        url: string;
        files: WikiPageFileItem[];
      }

      const videos: VideoItem[] = [];
      const wikiPages: WikiPageItem[] = [];
      const lmsSession = getLmsSession();

      for (const mod of modules) {
        if (!mod.module_items) continue;
        for (const item of mod.module_items) {
          const itemType = item.content_data?.item_content_data?.content_type || item.content_type;
          console.log('item', item);
          // 영상 콘텐츠(everlec/movie/video/mp4)
          if (VIDEO_TYPES.includes(itemType)) {
            const data = item.content_data?.item_content_data;
            if (data.content_id) {
              const available = data.content_id !== 'not_open';

              const dueAt = item.content_data?.due_at;
              const dueAtTimestamp = dueAt ? Date.parse(dueAt) : Number.NaN;
              const requiresAttendance = item.content_data?.use_attendance !== false;
              const isAbsent =
                requiresAttendance &&
                !item.completed &&
                !Number.isNaN(dueAtTimestamp) &&
                dueAtTimestamp < Date.now();

              videos.push({
                title: item.title,
                contentId: data.content_id,
                duration: data.duration || 0,
                fileSize: data.total_file_size || 0,
                thumbnailUrl: data.thumbnail_url || '',
                weekPosition: item.content_data.week_position || 0,
                available,
                isCompleted: item.completed || !item.content_data.use_attendance,
                isAbsent
              });
            }
            continue;
          }

          // wiki_page는 slug(content_data.url) 기반 페이지를 열어 embedded content_id를 추출
          if (itemType === 'wiki_page' && item.content_data?.url) {
            const pageUrl = `https://canvas.ssu.ac.kr/courses/${courseId}/pages/${item.content_data.url}?module_item_id=${item.module_item_id}`;
            const pageApiUrl = `https://canvas.ssu.ac.kr/api/v1/courses/${courseId}/pages/${encodeURIComponent(item.content_data.url)}`;

            try {
              const pageRes = await lmsSession.fetch(pageApiUrl, {
                headers: {
                  Accept: 'application/json'
                }
              });
              if (!pageRes.ok) continue;
              const pageData = await pageRes.json();
              const files = extractWikiFilesFromHtml(pageData?.body || '');
              if (files.length === 0) continue;

              wikiPages.push({
                title: item.title,
                courseId,
                weekPosition: item.content_data.week_position || 0,
                available: true,
                url: pageUrl,
                files
              });
            } catch {
              // 위키 페이지 접근 실패 시 해당 아이템만 건너뛰고 계속 처리
            }
          }
        }
      }

      return { success: true, videos, wikiPages };
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('401') || msg.includes('403')) {
        return { success: false, error: '로그인이 만료되었습니다. 다시 로그인해주세요.' };
      }
      return { success: false, error: msg };
    }
  });
}
