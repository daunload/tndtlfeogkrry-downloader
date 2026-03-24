<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { GEMINI_MODEL_OPTIONS, toSafeFileName } from '../../shared/config';
import type { GeminiModelId } from '../../shared/types';
import type { VideoItem } from './types';
import { useDownloader } from './composables/useDownloader';
import { useTranscriber } from './composables/useTranscriber';
import Sidebar from './components/layout/Sidebar.vue';
import StatusMessage from './components/layout/StatusMessage.vue';
import LoginScreen from './components/login/LoginScreen.vue';
import CourseList from './components/courses/CourseList.vue';
import VideoList from './components/videos/VideoList.vue';
import ApiKeySettings from './components/settings/ApiKeySettings.vue';
import LibraryView from './components/library/LibraryView.vue';

const {
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
} = useDownloader();

const {
  hasApiKey,
  selectedGeminiModel,
  withSummary,
  useFileApi,
  isTranscribingBatch,
  transcribeProgressMap,
  transcribeStatusMap,
  transcribeMessage,
  checkApiKey,
  saveApiKey,
  deleteApiKey,
  loadGeminiModel,
  saveGeminiModel,
  transcribe,
  downloadAndTranscribeAll
} = useTranscriber();

const showSettings = ref(false);
const showLibrary = ref(false);
const toastMessage = ref('');
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const activeView = computed<'courses' | 'library'>(() =>
  showLibrary.value ? 'library' : 'courses'
);

onMounted(() => {
  checkApiKey();
  loadGeminiModel();
  loadHistoryIds();
});

onUnmounted(() => {
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
});

// transcribeMessage가 있으면 message에 반영
watch(transcribeMessage, (val) => {
  if (val) message.value = val;
});

watch(message, (val) => {
  if (!val) {
    toastMessage.value = '';
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    return;
  }

  toastMessage.value = val;

  if (toastTimer) {
    clearTimeout(toastTimer);
  }

  toastTimer = setTimeout(() => {
    toastMessage.value = '';
    toastTimer = null;
  }, 3000);
});

async function openSettings(): Promise<void> {
  await loadGeminiModel();
  showSettings.value = true;
}

function openLibrary(): void {
  showLibrary.value = true;
}

function openCourses(): void {
  showLibrary.value = false;
  selectedCourseId.value = null;
}

/** txtPath에서 요약본 경로를 도출 */
function deriveSummaryPath(txtPath: string): string {
  return txtPath.replace(/\.txt$/, '_요약본.md');
}

async function handleTranscribe(video: { contentId: string; title: string }): Promise<void> {
  const savedPath = downloadedPaths.value[video.contentId];
  const safeName = toSafeFileName(video.title);

  if (savedPath) {
    const fileName = savedPath.split('/').pop() || `${safeName}.mp3`;
    const result = await transcribe(savedPath, fileName);
    if (result?.success && result.txtPath) {
      const summaryPath = withSummary.value ? deriveSummaryPath(result.txtPath) : undefined;
      await window.api.updateHistoryTranscription(video.contentId, result.txtPath, summaryPath);
    }
    return;
  }

  // 다운로드 경로가 없으면 폴더 선택
  let folder = downloadFolder.value;

  if (!folder) {
    const folderResult = await window.api.selectFolder();
    if (!folderResult.success || !folderResult.folderPath) return;
    folder = folderResult.folderPath;
  }

  const filePath = `${folder}/${safeName}.mp3`;
  const result = await transcribe(filePath, `${safeName}.mp3`);
  if (result?.success && result.txtPath) {
    const summaryPath = withSummary.value ? deriveSummaryPath(result.txtPath) : undefined;
    await window.api.updateHistoryTranscription(video.contentId, result.txtPath, summaryPath);
  }
}

async function handleDownloadAll(format: 'mp4' | 'mp3'): Promise<void> {
  downloadFormat.value = format;
  await downloadAll();
}

async function handleDownloadSelected(selected: VideoItem[], format: 'mp4' | 'mp3'): Promise<void> {
  downloadFormat.value = format;
  await downloadAll(selected);
}

function getCourseMeta(): { courseId: string; courseName: string } | undefined {
  const course = courses.value.find((c) => c.id === selectedCourseId.value);
  if (!course) return undefined;
  return { courseId: course.id, courseName: course.name };
}

async function handleTranscribeAll(): Promise<void> {
  if (videos.value.length === 0) return;
  await downloadAndTranscribeAll(
    videos.value.map((v) => ({
      contentId: v.contentId,
      title: v.title,
      fileSize: v.fileSize,
      duration: v.duration
    })),
    downloadFolder.value ?? undefined,
    getCourseMeta()
  );
  loadHistoryIds();
}

async function handleTranscribeSelected(selected: VideoItem[]): Promise<void> {
  if (selected.length === 0) return;
  await downloadAndTranscribeAll(
    selected.map((v) => ({
      contentId: v.contentId,
      title: v.title,
      fileSize: v.fileSize,
      duration: v.duration
    })),
    downloadFolder.value ?? undefined,
    getCourseMeta()
  );
  loadHistoryIds();
}

async function handleSaveApiKey(key: string): Promise<void> {
  await saveApiKey(key);
  showSettings.value = false;
}

async function handleDeleteApiKey(): Promise<void> {
  await deleteApiKey();
}

async function handleSaveGeminiModel(model: GeminiModelId): Promise<void> {
  await saveGeminiModel(model);
}
</script>

<template>
  <div
    class="flex h-screen bg-surface text-text-1 transition-colors duration-200 overflow-hidden font-sans"
  >
    <Sidebar
      :is-logged-in="isLoggedIn"
      :has-api-key="hasApiKey"
      :active-view="activeView"
      @login="login"
      @open-settings="openSettings"
      @open-library="openLibrary"
      @open-courses="openCourses"
    />

    <main class="flex-1 flex flex-col h-full overflow-hidden relative">
      <div
        class="flex-1 overflow-y-auto px-4 sm:px-6 md:px-10 py-6 sm:py-10 w-full max-w-6xl mx-auto"
      >
        <Transition name="fade" mode="out-in">
          <LoginScreen v-if="!isLoggedIn" @login="login" />

          <div v-else class="h-full">
            <Transition name="slide-fade" mode="out-in">
              <LibraryView v-if="showLibrary" @back="openCourses" />

              <CourseList
                v-else-if="!selectedCourseId"
                :courses="courses"
                :is-loading="isLoading"
                @refresh="fetchCourses"
                @relogin="login"
                @select="selectCourse"
              />

              <VideoList
                v-else
                v-model:with-summary="withSummary"
                v-model:use-file-api="useFileApi"
                :videos="videos"
                :is-loading="isLoading"
                :is-downloading-all="isDownloadingAll"
                :downloading-ids="downloadingIds"
                :progress-map="progressMap"
                :status-map="statusMap"
                :format-duration="formatDuration"
                :format-size="formatSize"
                :has-api-key="hasApiKey"
                :is-transcribing-batch="isTranscribingBatch"
                :transcribe-progress-map="transcribeProgressMap"
                :transcribe-status-map="transcribeStatusMap"
                :download-folder="downloadFolder"
                :history-content-ids="historyContentIds"
                @back="goBackToCourses"
                @download-all="handleDownloadAll"
                @download-selected="handleDownloadSelected"
                @download="download"
                @transcribe="handleTranscribe"
                @transcribe-all="handleTranscribeAll"
                @transcribe-selected="handleTranscribeSelected"
                @select-folder="selectDownloadFolder"
                @clear-folder="clearDownloadFolder"
              />
            </Transition>
          </div>
        </Transition>
      </div>

      <!-- 하단 고정 메시지 바 -->
      <div v-if="toastMessage" class="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-50">
        <StatusMessage :message="toastMessage" />
      </div>
    </main>

    <!-- API 키 설정 모달 -->
    <ApiKeySettings
      v-if="showSettings"
      :has-api-key="hasApiKey"
      :selected-model="selectedGeminiModel"
      :model-options="GEMINI_MODEL_OPTIONS"
      @save="handleSaveApiKey"
      @save-model="handleSaveGeminiModel"
      @delete="handleDeleteApiKey"
      @close="showSettings = false"
    />
  </div>
</template>

<style>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-fade-enter-active {
  transition: all 0.3s ease-out;
}

.slide-fade-leave-active {
  transition: all 0.2s cubic-bezier(1, 0.5, 0.8, 1);
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateX(10px);
  opacity: 0;
}
</style>
