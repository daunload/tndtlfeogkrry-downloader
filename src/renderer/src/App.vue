<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { toSafeFileName } from '../../shared/config';
import type { VideoItem } from './types';
import { useDownloader } from './composables/useDownloader';
import { useTranscriber } from './composables/useTranscriber';
import Sidebar from './components/layout/Sidebar.vue';
import StatusMessage from './components/layout/StatusMessage.vue';
import LoginScreen from './components/login/LoginScreen.vue';
import CourseList from './components/courses/CourseList.vue';
import VideoList from './components/videos/VideoList.vue';
import ApiKeySettings from './components/settings/ApiKeySettings.vue';

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
  login,
  fetchCourses,
  selectCourse,
  goBackToCourses,
  selectDownloadFolder,
  clearDownloadFolder,
  downloadAll,
  download,
  formatDuration,
  formatSize
} = useDownloader();

const {
  hasApiKey,
  withSummary,
  isTranscribingBatch,
  transcribeProgressMap,
  transcribeStatusMap,
  transcribeMessage,
  checkApiKey,
  saveApiKey,
  deleteApiKey,
  transcribe,
  downloadAndTranscribeAll
} = useTranscriber();

const showSettings = ref(false);

onMounted(() => {
  checkApiKey();
});

// transcribeMessage가 있으면 message에 반영
watch(transcribeMessage, (val) => {
  if (val) message.value = val;
});

async function handleTranscribe(video: { contentId: string; title: string }): Promise<void> {
  const savedPath = downloadedPaths.value[video.contentId];
  const safeName = toSafeFileName(video.title);

  if (savedPath) {
    const fileName = savedPath.split('/').pop() || `${safeName}.mp3`;
    await transcribe(savedPath, fileName);
    return;
  }

  // 다운로드 경로가 없으면 폴더 선택
  let folder = downloadFolder.value;

  if (!folder) {
    const result = await window.api.selectFolder();
    if (!result.success || !result.folderPath) return;
    folder = result.folderPath;
  }

  const filePath = `${folder}/${safeName}.mp3`;
  await transcribe(filePath, `${safeName}.mp3`);
}

async function handleDownloadSelected(selected: VideoItem[]): Promise<void> {
  await downloadAll(selected);
}

async function handleTranscribeAll(): Promise<void> {
  if (videos.value.length === 0) return;
  await downloadAndTranscribeAll(
    videos.value.map((v) => ({ contentId: v.contentId, title: v.title })),
    downloadFolder.value ?? undefined
  );
}

async function handleTranscribeSelected(selected: VideoItem[]): Promise<void> {
  if (selected.length === 0) return;
  await downloadAndTranscribeAll(
    selected.map((v) => ({ contentId: v.contentId, title: v.title })),
    downloadFolder.value ?? undefined
  );
}

async function handleSaveApiKey(key: string): Promise<void> {
  await saveApiKey(key);
  showSettings.value = false;
}

async function handleDeleteApiKey(): Promise<void> {
  await deleteApiKey();
}
</script>

<template>
  <div
    class="flex h-screen bg-surface text-text-1 transition-colors duration-200 overflow-hidden font-sans"
  >
    <Sidebar
      :is-logged-in="isLoggedIn"
      :has-api-key="hasApiKey"
      @login="login"
      @open-settings="showSettings = true"
    />

    <main class="flex-1 flex flex-col h-full overflow-hidden relative">
      <div
        class="flex-1 overflow-y-auto px-4 sm:px-6 md:px-10 py-6 sm:py-10 w-full max-w-6xl mx-auto"
      >
        <Transition name="fade" mode="out-in">
          <LoginScreen v-if="!isLoggedIn" @login="login" />

          <div v-else class="h-full">
            <Transition name="slide-fade" mode="out-in">
              <CourseList
                v-if="!selectedCourseId"
                :courses="courses"
                :is-loading="isLoading"
                @refresh="fetchCourses"
                @relogin="login"
                @select="selectCourse"
              />

              <VideoList
                v-else
                v-model:download-format="downloadFormat"
                v-model:with-summary="withSummary"
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
                @back="goBackToCourses"
                @download-all="downloadAll"
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
      <div v-if="message" class="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-50">
        <StatusMessage :message="message" />
      </div>
    </main>

    <!-- API 키 설정 모달 -->
    <ApiKeySettings
      v-if="showSettings"
      :has-api-key="hasApiKey"
      @save="handleSaveApiKey"
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
