<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { GEMINI_MODEL_OPTIONS, toSafeFileName } from '../../shared/config';
import type { GeminiModelId } from '../../shared/types';
import type { VideoItem, WikiPageFileItem } from './types';
import { useDownloader } from './composables/useDownloader';
import { useTranscriber } from './composables/useTranscriber';
import { useWikiFiles } from './composables/useWikiFiles';
import Sidebar from './components/layout/Sidebar.vue';
import StatusMessage from './components/layout/StatusMessage.vue';
import LoginScreen from './components/login/LoginScreen.vue';
import CourseList from './components/courses/CourseList.vue';
import VideoList from './components/videos/VideoList.vue';
import WikiPageList from './components/wiki/WikiPageList.vue';
import ApiKeySettings from './components/settings/ApiKeySettings.vue';
import LibraryView from './components/library/LibraryView.vue';
import MarkdownViewerView from './components/markdown/MarkdownViewerView.vue';

const {
  isLoggedIn,
  courses,
  selectedCourseId,
  videos,
  wikiPages,
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
const showMarkdown = ref(false);
const contentTab = ref<'video' | 'wiki'>('video');
const toastMessage = ref('');
let toastTimer: ReturnType<typeof setTimeout> | null = null;
const {
  downloadingWikiFileUrls,
  downloadedWikiFileUrls,
  summarizedWikiFileUrls,
  summarizingWikiFileUrls,
  loadWikiFileHistory,
  downloadWikiFile,
  summarizeWikiFile,
  wikiMessage
} = useWikiFiles();

const activeView = computed<'courses' | 'library' | 'markdown'>(() => {
  if (showLibrary.value) return 'library';
  if (showMarkdown.value) return 'markdown';
  return 'courses';
});

onMounted(() => {
  checkApiKey();
  loadGeminiModel();
  loadHistoryIds();
  loadWikiFileHistory();
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
watch(wikiMessage, (val) => {
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
  showMarkdown.value = false;
}

function openMarkdown(): void {
  showLibrary.value = false;
  showMarkdown.value = true;
}

function openCourses(): void {
  showLibrary.value = false;
  showMarkdown.value = false;
  contentTab.value = 'video';
  selectedCourseId.value = null;
}

async function handleSelectCourse(course: {
  id: string;
  name: string;
  term: string;
}): Promise<void> {
  contentTab.value = 'video';
  await selectCourse(course);
}

function handleBackToCourses(): void {
  contentTab.value = 'video';
  goBackToCourses();
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

async function handleDownloadWikiFile(file: WikiPageFileItem): Promise<void> {
  await downloadWikiFile(file, downloadFolder.value ?? undefined);
}

async function handleSummarizeWikiFile(file: WikiPageFileItem): Promise<void> {
  await summarizeWikiFile(file);
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
      @open-markdown="openMarkdown"
      @open-courses="openCourses"
    />

    <main class="flex-1 flex flex-col h-full overflow-hidden relative">
      <div
        class="flex-1 overflow-y-auto px-4 sm:px-6 md:px-10 py-6 sm:py-10 w-full max-w-6xl mx-auto"
      >
        <Transition name="fade" mode="out-in">
          <LoginScreen v-if="!isLoggedIn && !showMarkdown" @login="login" />

          <div v-else class="h-full">
            <Transition name="slide-fade" mode="out-in">
              <LibraryView v-if="showLibrary" @back="openCourses" />

              <MarkdownViewerView v-else-if="showMarkdown" />

              <CourseList
                v-else-if="!selectedCourseId"
                :courses="courses"
                :is-loading="isLoading"
                @refresh="fetchCourses"
                @relogin="login"
                @select="handleSelectCourse"
              />

              <div v-else class="h-full flex flex-col">
                <div class="mb-5 flex items-center gap-2">
                  <button
                    class="px-4 py-2 rounded-xl text-sm font-bold transition-all"
                    :class="
                      contentTab === 'video'
                        ? 'bg-primary text-white shadow-md'
                        : 'bg-surface-mute text-text-2 hover:text-text-1'
                    "
                    @click="contentTab = 'video'"
                  >
                    비디오 ({{ videos.length }})
                  </button>
                  <button
                    class="px-4 py-2 rounded-xl text-sm font-bold transition-all"
                    :class="
                      contentTab === 'wiki'
                        ? 'bg-primary text-white shadow-md'
                        : 'bg-surface-mute text-text-2 hover:text-text-1'
                    "
                    @click="contentTab = 'wiki'"
                  >
                    수업자료 ({{ wikiPages.length }})
                  </button>
                </div>

                <VideoList
                  v-if="contentTab === 'video'"
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
                  @back="handleBackToCourses"
                  @download-all="handleDownloadAll"
                  @download-selected="handleDownloadSelected"
                  @download="download"
                  @transcribe="handleTranscribe"
                  @transcribe-all="handleTranscribeAll"
                  @transcribe-selected="handleTranscribeSelected"
                  @select-folder="selectDownloadFolder"
                  @clear-folder="clearDownloadFolder"
                />

                <WikiPageList
                  v-else
                  :wiki-pages="wikiPages"
                  :is-loading="isLoading"
                  :download-folder="downloadFolder"
                  :downloading-file-urls="downloadingWikiFileUrls"
                  :downloaded-file-urls="downloadedWikiFileUrls"
                  :summarized-file-urls="summarizedWikiFileUrls"
                  :summarizing-file-urls="summarizingWikiFileUrls"
                  :has-api-key="hasApiKey"
                  @back="handleBackToCourses"
                  @select-folder="selectDownloadFolder"
                  @clear-folder="clearDownloadFolder"
                  @download-file="handleDownloadWikiFile"
                  @summarize-file="handleSummarizeWikiFile"
                />
              </div>
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
