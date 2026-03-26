import { el, render } from '../utils/dom.js';
import { api } from '../api.js';

export function renderLogin(container, onLoginSuccess) {
  const statusEl = el('div');

  const loginBtn = el('button', {
    className: 'btn btn-primary',
    style: { padding: '12px 32px', fontSize: '16px' },
    onClick: async () => {
      loginBtn.disabled = true;
      loginBtn.textContent = '로그인 중...';
      render(statusEl);

      try {
        await api.openLogin();
        render(statusEl, el('div', { className: 'status success' }, '로그인 성공!'));
        setTimeout(() => onLoginSuccess(), 500);
      } catch (err) {
        render(statusEl, el('div', { className: 'status error' }, '로그인 실패: ' + (err.message || err)));
        loginBtn.disabled = false;
        loginBtn.textContent = 'LMS 로그인';
      }
    },
  }, 'LMS 로그인');

  render(
    container,
    el('div', { className: 'login-container' },
      el('h1', {}, 'SSU LMS Downloader'),
      el('p', {}, '숭실대학교 Canvas LMS 강의 영상을 다운로드하고 텍스트로 변환하세요.'),
      loginBtn,
      statusEl,
    ),
  );
}
