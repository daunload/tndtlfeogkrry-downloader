import { el } from '../utils/dom.js';

export function createProgressBar() {
  const fill = el('div', { className: 'fill' });
  const bar = el('div', { className: 'progress-bar' }, fill);
  const text = el('div', { className: 'progress-text' });
  const wrapper = el('div', { className: 'video-item-progress', style: { display: 'none' } }, bar, text);

  return {
    element: wrapper,
    update(percent, message) {
      wrapper.style.display = 'block';
      fill.style.width = Math.min(100, Math.max(0, percent)) + '%';
      if (message) text.textContent = message;
    },
    complete(message) {
      fill.style.width = '100%';
      fill.classList.add('complete');
      if (message) text.textContent = message;
    },
    error(message) {
      fill.classList.add('error');
      if (message) text.textContent = message;
    },
    reset() {
      wrapper.style.display = 'none';
      fill.style.width = '0%';
      fill.classList.remove('complete', 'error');
      text.textContent = '';
    },
  };
}

// Track progress by content ID
const progressTrackers = new Map();

export function getProgressTracker(contentId) {
  if (!progressTrackers.has(contentId)) {
    progressTrackers.set(contentId, createProgressBar());
  }
  return progressTrackers.get(contentId);
}

export function clearProgressTrackers() {
  progressTrackers.clear();
}
