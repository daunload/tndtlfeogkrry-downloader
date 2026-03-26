import { el, render } from '../utils/dom.js';
import { api, selectFolder } from '../api.js';

export async function renderSettings(container, onBack) {
  const savedApiKey = localStorage.getItem('gemini_api_key') || '';
  const savedModel = localStorage.getItem('gemini_model') || '';
  const savedFolder = localStorage.getItem('download_folder') || '';

  const statusEl = el('div');

  const apiKeyInput = el('input', {
    type: 'password',
    placeholder: 'Gemini API 키를 입력하세요',
    value: savedApiKey,
  });
  // Set value after creation since el() uses setAttribute
  apiKeyInput.value = savedApiKey;

  const modelSelect = el('select');
  modelSelect.appendChild(el('option', { value: '' }, '모델을 불러오는 중...'));

  const folderInput = el('input', {
    type: 'text',
    placeholder: '다운로드 폴더를 선택하세요',
    readonly: 'readonly',
  });
  folderInput.value = savedFolder;

  const folderBtn = el('button', {
    className: 'btn btn-secondary',
    onClick: async () => {
      const folder = await selectFolder();
      if (folder) folderInput.value = folder;
    },
  }, '선택');

  const saveBtn = el('button', {
    className: 'btn btn-primary',
    onClick: () => {
      localStorage.setItem('gemini_api_key', apiKeyInput.value.trim());
      localStorage.setItem('gemini_model', modelSelect.value);
      if (folderInput.value) localStorage.setItem('download_folder', folderInput.value);

      render(statusEl, el('div', { className: 'status success' }, '설정이 저장되었습니다.'));
      setTimeout(() => render(statusEl), 2000);
    },
  }, '저장');

  const backBtn = el('button', {
    className: 'btn btn-secondary',
    onClick: onBack,
  }, '뒤로');

  render(
    container,
    el('div', { className: 'settings-container' },
      el('h2', {}, '설정'),
      el('div', { className: 'form-group' },
        el('label', {}, 'Gemini API 키'),
        apiKeyInput,
      ),
      el('div', { className: 'form-group' },
        el('label', {}, 'Gemini 모델'),
        modelSelect,
      ),
      el('div', { className: 'form-group' },
        el('label', {}, '다운로드 폴더'),
        el('div', { className: 'folder-selector' },
          folderInput,
          folderBtn,
        ),
      ),
      statusEl,
      el('div', { className: 'form-actions' },
        saveBtn,
        backBtn,
      ),
    ),
  );

  // Load model options
  try {
    const models = await api.getGeminiModelOptions();
    modelSelect.innerHTML = '';
    modelSelect.appendChild(el('option', { value: '' }, '-- 모델 선택 --'));
    if (Array.isArray(models)) {
      for (const model of models) {
        const name = typeof model === 'string' ? model : model.name || model.id;
        const value = typeof model === 'string' ? model : model.id || model.name;
        const opt = el('option', { value }, name);
        if (value === savedModel) opt.selected = true;
        modelSelect.appendChild(opt);
      }
    }
  } catch (err) {
    modelSelect.innerHTML = '';
    modelSelect.appendChild(el('option', { value: '' }, '모델 목록을 불러올 수 없습니다'));
    console.error('Failed to load model options:', err);
  }
}
