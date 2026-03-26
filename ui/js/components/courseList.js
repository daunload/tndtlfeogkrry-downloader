import { el, render } from '../utils/dom.js';
import { api } from '../api.js';

export async function renderCourseList(container, onCourseSelect, onSettings) {
  render(
    container,
    el('div', { className: 'nav-bar' },
      el('h2', {}, '내 강의'),
      el('button', { className: 'btn btn-secondary btn-sm', onClick: onSettings }, '설정'),
    ),
    el('div', { className: 'loading' }, '강의 목록을 불러오는 중...'),
  );

  try {
    const courses = await api.fetchCourses();

    if (!courses || courses.length === 0) {
      render(
        container,
        el('div', { className: 'nav-bar' },
          el('h2', {}, '내 강의'),
          el('button', { className: 'btn btn-secondary btn-sm', onClick: onSettings }, '설정'),
        ),
        el('div', { className: 'empty-state' }, '등록된 강의가 없습니다.'),
      );
      return;
    }

    const courseCards = courses.map((course) =>
      el('div', {
        className: 'course-card',
        onClick: () => onCourseSelect(course),
      },
        el('h3', {}, course.name || course.title || '(제목 없음)'),
        el('p', {}, course.course_code || course.code || ''),
      ),
    );

    render(
      container,
      el('div', { className: 'nav-bar' },
        el('h2', {}, '내 강의'),
        el('button', { className: 'btn btn-secondary btn-sm', onClick: onSettings }, '설정'),
      ),
      el('div', { className: 'course-list' }, ...courseCards),
    );
  } catch (err) {
    render(
      container,
      el('div', { className: 'nav-bar' },
        el('h2', {}, '내 강의'),
        el('button', { className: 'btn btn-secondary btn-sm', onClick: onSettings }, '설정'),
      ),
      el('div', { className: 'status error' }, '강의 목록을 불러오지 못했습니다: ' + (err.message || err)),
    );
  }
}
