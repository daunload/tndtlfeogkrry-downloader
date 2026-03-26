import { renderLogin } from './components/login.js';
import { renderCourseList } from './components/courseList.js';
import { renderVideoList } from './components/videoList.js';
import { renderSettings } from './components/settings.js';

const app = document.getElementById('app');

export function navigate(view, data) {
  switch (view) {
    case 'login':
      renderLogin(app, () => navigate('courses'));
      break;
    case 'courses':
      renderCourseList(app, (course) => navigate('videos', course), () => navigate('settings'));
      break;
    case 'videos':
      renderVideoList(app, data, () => navigate('courses'));
      break;
    case 'settings':
      renderSettings(app, () => navigate('courses'));
      break;
  }
}

document.addEventListener('DOMContentLoaded', () => navigate('login'));
