<script setup lang="ts">
import { useDownloader } from './composables/useDownloader'
import Sidebar from './components/layout/Sidebar.vue'
import StatusMessage from './components/layout/StatusMessage.vue'
import LoginScreen from './components/login/LoginScreen.vue'
import CourseList from './components/courses/CourseList.vue'
import VideoList from './components/videos/VideoList.vue'

const {
  isLoggedIn,
  courses,
  selectedCourseId,
  videos,
  isLoading,
  message,
  downloadingIds,
  progressMap,
  downloadFormat,
  isDownloadingAll,
  login,
  fetchCourses,
  selectCourse,
  goBackToCourses,
  downloadAll,
  download,
  formatDuration,
  formatSize
} = useDownloader()
</script>

<template>
  <div class="flex h-screen bg-surface text-text-1 transition-colors duration-200 overflow-hidden font-sans">
    <Sidebar :is-logged-in="isLoggedIn" @login="login" />

    <main class="flex-1 flex flex-col h-full overflow-hidden relative">
      <div class="flex-1 overflow-y-auto px-10 py-10 w-full max-w-5xl mx-auto">
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
                :videos="videos"
                :is-loading="isLoading"
                :is-downloading-all="isDownloadingAll"
                :downloading-ids="downloadingIds"
                :progress-map="progressMap"
                :format-duration="formatDuration"
                :format-size="formatSize"
                v-model:download-format="downloadFormat"
                @back="goBackToCourses"
                @download-all="downloadAll"
                @download="download"
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
