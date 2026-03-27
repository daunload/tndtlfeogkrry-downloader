import { el, render } from '../utils/dom.js';
import { api, events, selectFolder } from '../api.js';
import { formatBytes, formatDuration } from '../utils/format.js';
import { getProgressTracker, clearProgressTrackers } from './downloadProgress.js';
import { renderWikiList } from './wikiList.js';

let unlistenDownload = null;
let unlistenTranscribe = null;

function getSettings() {
  return {
    apiKey: localStorage.getItem('gemini_api_key') || '',
    model: localStorage.getItem('gemini_model') || '',
    folder: localStorage.getItem('download_folder') || '',
  };
}

export async function renderVideoList(container, course, onBack) {
  clearProgressTrackers();

  // Clean up old listeners
  if (unlistenDownload) { unlistenDownload(); unlistenDownload = null; }
  if (unlistenTranscribe) { unlistenTranscribe(); unlistenTranscribe = null; }

  const courseName = course.name || course.title || '(제목 없음)';

  // Format selector state
  let selectedFormat = 'mp4';

  const formatSelect = el('select', {
    onChange: (e) => { selectedFormat = e.target.value; },
  },
    el('option', { value: 'mp4' }, 'MP4 (영상)'),
    el('option', { value: 'm4a' }, 'M4A (오디오)'),
  );

  const downloadAllBtn = el('button', {
    className: 'btn btn-primary btn-sm',
    onClick: () => handleDownloadAll(),
  }, '전체 다운로드');

  const contentArea = el('div');

  render(
    container,
    el('div', { className: 'nav-bar' },
      el('button', { className: 'back-btn', onClick: () => {
        if (unlistenDownload) { unlistenDownload(); unlistenDownload = null; }
        if (unlistenTranscribe) { unlistenTranscribe(); unlistenTranscribe = null; }
        onBack();
      }}, '< 뒤로'),
      el('h2', {}, courseName),
      el('div'),
    ),
    el('div', { className: 'toolbar' },
      el('span', { style: { fontSize: '13px', color: '#6b7280' } }, '형식:'),
      formatSelect,
      downloadAllBtn,
    ),
    contentArea,
  );

  render(contentArea, el('div', { className: 'loading' }, '모듈 정보를 불러오는 중...'));

  try {
    const modules = await api.fetchModules(course.id);

    // Set up event listeners
    unlistenDownload = await events.onDownloadProgress((payload) => {
      const tracker = getProgressTracker(payload.content_id || payload.contentId);
      if (payload.status === 'complete' || payload.status === 'done') {
        tracker.complete(payload.message || '다운로드 완료');
      } else if (payload.status === 'error') {
        tracker.error(payload.message || '오류 발생');
      } else {
        const pct = payload.percent || payload.progress || 0;
        tracker.update(pct, payload.message || `${Math.round(pct)}%`);
      }
    });

    unlistenTranscribe = await events.onTranscribeProgress((payload) => {
      const tracker = getProgressTracker(payload.content_id || payload.contentId);
      if (payload.status === 'complete' || payload.status === 'done') {
        tracker.complete(payload.message || '변환 완료');
      } else if (payload.status === 'error') {
        tracker.error(payload.message || '오류 발생');
      } else {
        const pct = payload.percent || payload.progress || 0;
        tracker.update(pct, payload.message || `텍스트 변환 ${Math.round(pct)}%`);
      }
    });

    // Backend returns [VideoItem[], WikiPageItem[]] tuple
    const [videos, wikis] = Array.isArray(modules) && Array.isArray(modules[0])
      ? modules
      : [modules, []];

    if ((!videos || videos.length === 0) && (!wikis || wikis.length === 0)) {
      render(contentArea, el('div', { className: 'empty-state' }, '모듈이 없습니다.'));
      return;
    }

    const allVideos = [];
    const elements = [];

    // Group videos by weekPosition
    const weekMap = new Map();
    for (const video of (videos || [])) {
      const week = video.weekPosition ?? 0;
      if (!weekMap.has(week)) weekMap.set(week, []);
      weekMap.get(week).push(video);
    }

    for (const [week, weekVideos] of [...weekMap.entries()].sort((a, b) => a[0] - b[0])) {
      const moduleEl = el('div', { className: 'module-group' },
        el('h3', {}, `${week}주차`),
      );
      const videoListEl = el('div', { className: 'video-list' });
      for (const video of weekVideos) {
        allVideos.push(video);
        videoListEl.appendChild(createVideoItem(video, () => selectedFormat));
      }
      moduleEl.appendChild(videoListEl);
      elements.push(moduleEl);
    }

    // Wiki pages section
    if (wikis && wikis.length > 0) {
      const wikiGroupEl = el('div', { className: 'module-group' },
        el('h3', {}, '수업 자료'),
      );
      const wikiEl = el('div', { className: 'wiki-section' });
      renderWikiList(wikiEl, wikis);
      wikiGroupEl.appendChild(wikiEl);
      elements.push(wikiGroupEl);
    }

    if (elements.length === 0) {
      render(contentArea, el('div', { className: 'empty-state' }, '다운로드 가능한 항목이 없습니다.'));
    } else {
      render(contentArea, el('div', { className: 'scroll-container' }, ...elements));
    }

    // Download all handler
    async function handleDownloadAll() {
      const settings = getSettings();
      let folder = settings.folder;

      if (!folder) {
        folder = await selectFolder();
        if (!folder) return;
        localStorage.setItem('download_folder', folder);
      }

      downloadAllBtn.disabled = true;
      downloadAllBtn.textContent = '다운로드 중...';

      try {
        const videoData = allVideos.map((v) => ({
          content_id: v.contentId || v.content_id,
          title: v.title || v.name,
        }));
        await api.downloadAll(videoData, folder, selectedFormat, {});
      } catch (err) {
        console.error('Download all error:', err);
      } finally {
        downloadAllBtn.disabled = false;
        downloadAllBtn.textContent = '전체 다운로드';
      }
    }
  } catch (err) {
    render(contentArea,
      el('div', { className: 'status error' },
        '모듈을 불러오지 못했습니다: ' + (err.message || err),
      ),
    );
  }
}

function createVideoItem(video, getFormat) {
  const contentId = video.contentId || video.content_id;
  const title = video.title || video.name || '(제목 없음)';
  const duration = video.duration ? formatDuration(video.duration) : '';
  const fileSize = video.fileSize || video.file_size;
  const sizeStr = fileSize ? formatBytes(fileSize) : '';
  const metaText = [duration, sizeStr].filter(Boolean).join(' / ');

  const progress = getProgressTracker(contentId);
  const statusEl = el('div');

  const downloadBtn = el('button', {
    className: 'btn btn-primary btn-sm',
    onClick: async () => {
      const settings = getSettings();
      let folder = settings.folder;

      if (!folder) {
        folder = await selectFolder();
        if (!folder) return;
        localStorage.setItem('download_folder', folder);
      }

      downloadBtn.disabled = true;
      progress.reset();
      render(statusEl);

      try {
        await api.downloadVideo(contentId, title, folder, getFormat(), {});
      } catch (err) {
        progress.error('다운로드 실패');
        render(statusEl, el('div', { className: 'status error' }, err.message || String(err)));
      } finally {
        downloadBtn.disabled = false;
      }
    },
  }, '다운로드');

  const transcribeBtn = el('button', {
    className: 'btn btn-secondary btn-sm',
    onClick: async () => {
      const settings = getSettings();
      if (!settings.apiKey) {
        render(statusEl, el('div', { className: 'status error' }, '설정에서 Gemini API 키를 입력해주세요.'));
        return;
      }

      let folder = settings.folder;
      if (!folder) {
        folder = await selectFolder();
        if (!folder) return;
        localStorage.setItem('download_folder', folder);
      }

      transcribeBtn.disabled = true;
      progress.reset();
      render(statusEl);

      try {
        // Download as m4a first, then transcribe
        const result = await api.downloadVideo(contentId, title, folder, 'm4a', {});
        const filePath = result.filePath || result.file_path || result;
        await api.transcribeAudio(filePath, false, true, settings.apiKey, settings.model);
        progress.complete('텍스트 변환 완료');
      } catch (err) {
        progress.error('변환 실패');
        render(statusEl, el('div', { className: 'status error' }, err.message || String(err)));
      } finally {
        transcribeBtn.disabled = false;
      }
    },
  }, '텍스트 변환');

  return el('div', { className: 'video-item' },
    el('div', { className: 'video-item-header' },
      el('div', { className: 'video-item-info' },
        el('h4', {}, title),
        metaText ? el('span', { className: 'meta' }, metaText) : el('span'),
      ),
      el('div', { className: 'video-item-actions' },
        downloadBtn,
        transcribeBtn,
      ),
    ),
    progress.element,
    statusEl,
  );
}
