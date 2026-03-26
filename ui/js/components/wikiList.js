import { el, render } from '../utils/dom.js';
import { api, selectFolder } from '../api.js';

export function renderWikiList(container, wikiPages) {
  if (!wikiPages || wikiPages.length === 0) {
    render(container, el('div', { className: 'empty-state' }, '위키 페이지가 없습니다.'));
    return;
  }

  const sectionTitle = el('h3', {}, '위키 페이지');
  const pageElements = wikiPages.map((page) => createWikiPage(page));

  render(container, sectionTitle, ...pageElements);
}

function createWikiPage(page) {
  const title = page.title || page.name || '(제목 없음)';
  const files = page.files || page.attachments || [];

  const filesContainer = el('div');

  if (files.length === 0) {
    filesContainer.appendChild(
      el('div', { style: { fontSize: '13px', color: '#9ca3af', padding: '4px 0' } }, '첨부 파일 없음'),
    );
  } else {
    for (const file of files) {
      filesContainer.appendChild(createWikiFile(file));
    }
  }

  return el('div', { className: 'wiki-page' },
    el('div', { className: 'wiki-page-header' },
      el('h4', {}, title),
    ),
    filesContainer,
  );
}

function createWikiFile(file) {
  const fileName = file.display_name || file.name || file.title || '(파일)';
  const downloadUrl = file.url || file.download_url;
  const statusEl = el('div');

  const downloadBtn = el('button', {
    className: 'btn btn-primary btn-sm',
    onClick: async () => {
      const folder = await selectFolder();
      if (!folder) return;

      downloadBtn.disabled = true;
      render(statusEl);

      try {
        await api.downloadWikiFile(downloadUrl, fileName, folder);
        render(statusEl, el('div', { className: 'status success' }, '다운로드 완료'));
      } catch (err) {
        render(statusEl, el('div', { className: 'status error' }, '다운로드 실패: ' + (err.message || err)));
      } finally {
        downloadBtn.disabled = false;
      }
    },
  }, '다운로드');

  const summarizeBtn = el('button', {
    className: 'btn btn-secondary btn-sm',
    onClick: async () => {
      const apiKey = localStorage.getItem('gemini_api_key');
      const model = localStorage.getItem('gemini_model') || '';

      if (!apiKey) {
        render(statusEl, el('div', { className: 'status error' }, '설정에서 Gemini API 키를 입력해주세요.'));
        return;
      }

      const folder = await selectFolder();
      if (!folder) return;

      summarizeBtn.disabled = true;
      render(statusEl, el('div', { className: 'status info' }, '파일 다운로드 중...'));

      try {
        // Download PDF first
        const result = await api.downloadWikiFile(downloadUrl, fileName, folder);
        const pdfPath = result.filePath || result.file_path || result;

        render(statusEl, el('div', { className: 'status info' }, '요약 생성 중...'));
        const summary = await api.summarizeWikiPdf(pdfPath, apiKey, model);

        render(statusEl,
          el('div', { className: 'status success', style: { whiteSpace: 'pre-wrap', maxHeight: '200px', overflowY: 'auto' } },
            typeof summary === 'string' ? summary : JSON.stringify(summary, null, 2),
          ),
        );
      } catch (err) {
        render(statusEl, el('div', { className: 'status error' }, '요약 실패: ' + (err.message || err)));
      } finally {
        summarizeBtn.disabled = false;
      }
    },
  }, '요약');

  const isPdf = fileName.toLowerCase().endsWith('.pdf');

  return el('div', { className: 'wiki-file' },
    el('span', { className: 'wiki-file-name' }, fileName),
    el('div', { className: 'wiki-file-actions' },
      downloadBtn,
      isPdf ? summarizeBtn : el('span'),
    ),
    statusEl,
  );
}
