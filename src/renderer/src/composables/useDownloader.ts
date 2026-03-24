import { ref, computed, onUnmounted, type Ref } from 'vue';
import type { CourseItem, VideoItem } from '../types';

const isLoggedIn = ref(false);
const courses = ref<CourseItem[]>([]);
const selectedCourseId = ref<string | null>(null);
const videos = ref<VideoItem[]>([]);
const isLoading = ref(false);
const message = ref('');
const downloadingIds = ref<Set<string>>(new Set());
const progressMap = ref<Record<string, number>>({});
const statusMap = ref<
  Record<string, { status: string; splitCurrent?: number; splitTotal?: number }>
>({});
const downloadFormat = ref<'mp4' | 'mp3'>('mp4');
const downloadFolder = ref<string | null>(null);
const downloadedPaths = ref<Record<string, string>>({});
const isDownloadingAll = ref(false);
const historyContentIds = ref<Set<string>>(new Set());

/** 현재 선택된 코스 정보 */
const selectedCourse = computed(() => courses.value.find((c) => c.id === selectedCourseId.value));

interface UseDownloaderReturn {
  isLoggedIn: Ref<boolean>;
  courses: Ref<CourseItem[]>;
  selectedCourseId: Ref<string | null>;
  videos: Ref<VideoItem[]>;
  isLoading: Ref<boolean>;
  message: Ref<string>;
  downloadingIds: Ref<Set<string>>;
  progressMap: Ref<Record<string, number>>;
  statusMap: Ref<Record<string, { status: string; splitCurrent?: number; splitTotal?: number }>>;
  downloadFormat: Ref<'mp4' | 'mp3'>;
  downloadFolder: Ref<string | null>;
  downloadedPaths: Ref<Record<string, string>>;
  isDownloadingAll: Ref<boolean>;
  historyContentIds: Ref<Set<string>>;
  login: () => Promise<void>;
  fetchCourses: () => Promise<void>;
  selectCourse: (course: CourseItem) => Promise<void>;
  goBackToCourses: () => void;
  selectDownloadFolder: () => Promise<void>;
  clearDownloadFolder: () => void;
  downloadAll: (targetVideos?: VideoItem[]) => Promise<void>;
  download: (video: VideoItem) => Promise<void>;
  loadHistoryIds: () => Promise<void>;
  formatDuration: (seconds: number) => string;
  formatSize: (bytes: number) => string;
}

export function useDownloader(): UseDownloaderReturn {
  window.api.onDownloadProgress((data) => {
    progressMap.value[data.contentId] = data.percent;
    if (data.status) {
      statusMap.value[data.contentId] = {
        status: data.status,
        splitCurrent: data.splitCurrent,
        splitTotal: data.splitTotal
      };
    }
    if (data.batchCompleted != null && data.batchTotal != null) {
      message.value = `다운로드 중: ${data.batchCompleted}/${data.batchTotal}개 완료`;
    }
  });

  onUnmounted(() => {
    window.api.removeDownloadProgress();
  });

  async function loadHistoryIds(): Promise<void> {
    const result = await window.api.getHistory();
    if (result.success && result.records) {
      historyContentIds.value = new Set(result.records.map((r) => r.contentId));
    }
  }

  /** 현재 코스의 메타 정보 (main 프로세스에서 히스토리 기록용) */
  function getDownloadMeta(): { courseId: string; courseName: string } | undefined {
    const course = selectedCourse.value;
    if (!course) return undefined;
    return { courseId: course.id, courseName: course.name };
  }

  async function login(): Promise<void> {
    message.value = '로그인 창을 열고 있습니다...';
    const result = await window.api.openLogin();
    if (result.success) {
      isLoggedIn.value = true;
      message.value = '';
      fetchCourses();
    } else {
      message.value = '로그인이 취소되었습니다.';
    }
  }

  async function fetchCourses(): Promise<void> {
    isLoading.value = true;
    message.value = '과목 목록을 불러오는 중...';
    courses.value = [];
    selectedCourseId.value = null;
    videos.value = [];

    const result = await window.api.fetchCourses();

    isLoading.value = false;

    if (result.success && result.courses) {
      courses.value = result.courses;
      message.value = `${result.courses.length}개의 과목을 찾았습니다.`;
    } else if (result.error?.includes('로그인')) {
      isLoggedIn.value = false;
      message.value = result.error;
    } else {
      message.value = result.error || '과목 조회 실패';
    }
  }

  async function selectCourse(course: CourseItem): Promise<void> {
    selectedCourseId.value = course.id;
    isLoading.value = true;
    message.value = `${course.name} 강의 영상을 불러오는 중...`;
    videos.value = [];
    progressMap.value = {};

    const result = await window.api.fetchModules(course.id);

    isLoading.value = false;

    if (result.success && result.videos) {
      videos.value = result.videos;
      message.value = `${result.videos.length}개의 비디오를 찾았습니다.`;
      if (result.videos.length === 0) {
        message.value = '다운로드 가능한 비디오가 없습니다.';
      }
    } else if (result.error?.includes('로그인')) {
      isLoggedIn.value = false;
      message.value = result.error;
    } else {
      message.value = result.error || '강의 목록 조회 실패';
    }
  }

  function goBackToCourses(): void {
    selectedCourseId.value = null;
    videos.value = [];
    progressMap.value = {};
    downloadedPaths.value = {};
    message.value = '';
  }

  async function selectDownloadFolder(): Promise<void> {
    const result = await window.api.selectDownloadFolder();
    if (result.success && result.folderPath) {
      downloadFolder.value = result.folderPath;
    }
  }

  function clearDownloadFolder(): void {
    downloadFolder.value = null;
  }

  async function downloadAll(targetVideos?: VideoItem[]): Promise<void> {
    const targets = targetVideos || videos.value;
    if (targets.length === 0) return;
    isDownloadingAll.value = true;
    message.value = `${targets.length}개 다운로드를 시작합니다...`;

    for (const v of targets) {
      downloadingIds.value.add(v.contentId);
      progressMap.value[v.contentId] = 0;
    }

    const meta = getDownloadMeta();
    const result = await window.api.downloadAll(
      targets.map((v) => ({
        contentId: v.contentId,
        title: v.title,
        fileSize: v.fileSize,
        duration: v.duration
      })),
      downloadFormat.value,
      downloadFolder.value ?? undefined,
      meta
    );

    isDownloadingAll.value = false;

    if (result.error === 'cancelled') {
      for (const v of targets) {
        downloadingIds.value.delete(v.contentId);
        delete progressMap.value[v.contentId];
      }
      message.value = '';
      return;
    }

    for (const v of targets) {
      downloadingIds.value.delete(v.contentId);
    }

    if (result.success && result.results) {
      for (const r of result.results) {
        const v = targets.find((v) => v.title === r.title);
        if (v) {
          progressMap.value[v.contentId] = r.success ? 100 : -1;
          if (r.success && r.filePath) {
            downloadedPaths.value[v.contentId] = r.filePath;
            historyContentIds.value.add(v.contentId);
          }
        }
      }
      message.value = `다운로드 완료: ${result.successCount}/${result.total}개 성공`;
    } else {
      message.value = result.error || '다운로드 실패';
    }
  }

  async function download(video: VideoItem): Promise<void> {
    downloadingIds.value.add(video.contentId);
    progressMap.value[video.contentId] = 0;

    const meta = getDownloadMeta();
    const result = await window.api.downloadVideo(
      video.contentId,
      video.title,
      downloadFormat.value,
      downloadFolder.value ?? undefined,
      meta ? { ...meta, fileSize: video.fileSize, duration: video.duration } : undefined
    );

    downloadingIds.value.delete(video.contentId);

    if (result.success) {
      progressMap.value[video.contentId] = 100;
      if (result.filePath) {
        downloadedPaths.value[video.contentId] = result.filePath;
        historyContentIds.value.add(video.contentId);
      }
      message.value = `다운로드 완료: ${video.title}`;
    } else if (result.error !== 'cancelled') {
      delete progressMap.value[video.contentId];
      message.value = `다운로드 실패 (${video.title}): ${result.error}`;
    }
  }

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}분 ${s}초`;
  }

  function formatSize(bytes: number): string {
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  return {
    isLoggedIn,
    courses,
    selectedCourseId,
    videos,
    isLoading,
    message,
    downloadingIds,
    progressMap,
    statusMap,
    downloadFormat,
    downloadFolder,
    downloadedPaths,
    isDownloadingAll,
    historyContentIds,
    login,
    fetchCourses,
    selectCourse,
    goBackToCourses,
    selectDownloadFolder,
    clearDownloadFolder,
    downloadAll,
    download,
    loadHistoryIds,
    formatDuration,
    formatSize
  };
}
