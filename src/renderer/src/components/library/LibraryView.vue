<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  ArrowLeft,
  FolderOpen,
  FileText,
  BookOpen,
  Play,
  Music,
  Trash2,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  Loader2
} from 'lucide-vue-next';
import { useLibrary } from '../../composables/useLibrary';

const emit = defineEmits<{
  back: [];
}>();

const {
  records,
  isLoading,
  groupedByCourse,
  loadHistory,
  removeFromHistory,
  openFile,
  showInFolder,
  formatDate,
  formatSize,
  formatDuration
} = useLibrary();

const collapsedCourses = ref<Set<string>>(new Set());

function toggleCourse(courseName: string): void {
  if (collapsedCourses.value.has(courseName)) {
    collapsedCourses.value.delete(courseName);
  } else {
    collapsedCourses.value.add(courseName);
  }
}

onMounted(() => {
  loadHistory();
});
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-6 gap-4">
      <div class="flex items-center gap-3">
        <button
          class="flex items-center justify-center w-9 h-9 rounded-xl bg-surface-mute text-text-2 hover:bg-primary hover:text-white transition-all cursor-pointer"
          title="뒤로가기"
          @click="emit('back')"
        >
          <ArrowLeft :size="18" />
        </button>
        <div>
          <h2 class="text-xl sm:text-2xl font-bold text-text-1 tracking-tight">내 라이브러리</h2>
          <p class="text-sm text-text-3 mt-1 font-medium">다운로드한 파일을 관리할 수 있습니다.</p>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="flex-1 flex items-center justify-center">
      <Loader2 :size="32" class="animate-spin text-primary" />
    </div>

    <!-- Empty State -->
    <div
      v-else-if="records.length === 0"
      class="flex-1 flex flex-col items-center justify-center text-text-3 py-16"
    >
      <BookOpen :size="48" class="text-text-3 opacity-30 mb-4" />
      <p class="text-lg font-bold text-text-2">다운로드 기록이 없습니다.</p>
      <p class="text-sm mt-1.5 font-medium opacity-70">
        강의 영상을 다운로드하면 여기에 기록됩니다.
      </p>
    </div>

    <!-- Library Content -->
    <div v-else class="flex flex-col gap-4 pb-8">
      <div v-for="[courseName, courseRecords] in groupedByCourse" :key="courseName">
        <!-- Course Group Header -->
        <button
          class="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-surface-mute hover:bg-surface-mute/80 transition-all cursor-pointer mb-2"
          @click="toggleCourse(courseName)"
        >
          <ChevronDown
            v-if="!collapsedCourses.has(courseName)"
            :size="16"
            class="text-text-3 shrink-0"
          />
          <ChevronRight v-else :size="16" class="text-text-3 shrink-0" />
          <span class="text-sm font-bold text-text-1 truncate">{{ courseName }}</span>
          <span class="text-xs font-semibold text-text-3 ml-auto shrink-0"
            >{{ courseRecords.length }}개</span
          >
        </button>

        <!-- Records -->
        <div v-if="!collapsedCourses.has(courseName)" class="flex flex-col gap-2 ml-1">
          <div
            v-for="record in courseRecords"
            :key="record.contentId"
            class="flex flex-col sm:flex-row items-stretch gap-3 sm:gap-4 p-4 border border-border/60 rounded-[18px] bg-surface transition-all duration-200 hover:border-primary/30 hover:shadow-sm"
          >
            <!-- Info -->
            <div class="flex-1 min-w-0 flex flex-col justify-center">
              <div class="flex items-center gap-2 mb-1.5">
                <span
                  class="text-base font-bold text-text-1 truncate"
                  :class="{ 'opacity-50': !record.fileExists }"
                >
                  {{ record.title }}
                </span>
              </div>
              <div
                class="flex flex-wrap items-center gap-2.5 text-[10px] sm:text-xs text-text-3 font-semibold"
              >
                <!-- Format Badge -->
                <span
                  class="flex items-center gap-1 px-2 py-0.5 rounded-md font-bold"
                  :class="
                    record.format === 'mp4'
                      ? 'bg-blue-500/10 text-blue-500'
                      : 'bg-orange-500/10 text-orange-500'
                  "
                >
                  <Play v-if="record.format === 'mp4'" :size="10" />
                  <Music v-else :size="10" />
                  {{ record.format.toUpperCase() }}
                </span>

                <span class="text-text-3">{{ formatDuration(record.duration) }}</span>
                <span class="text-text-3">{{ formatSize(record.fileSize) }}</span>
                <span class="text-text-3 opacity-70">{{ formatDate(record.downloadedAt) }}</span>

                <!-- File missing indicator -->
                <span
                  v-if="!record.fileExists"
                  class="flex items-center gap-1 text-warning font-bold"
                >
                  <AlertCircle :size="12" />
                  파일 없음
                </span>

                <!-- Transcription badges -->
                <span
                  v-if="record.txtExists"
                  class="flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-500 font-bold"
                >
                  <FileText :size="10" />
                  텍스트
                </span>
                <span
                  v-if="record.summaryExists"
                  class="flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-500 font-bold"
                >
                  <BookOpen :size="10" />
                  요약본
                </span>
              </div>
            </div>

            <!-- Actions -->
            <div
              class="flex items-center gap-1.5 pl-0 sm:pl-3 border-t sm:border-t-0 sm:border-l border-border/50 mt-2 sm:mt-0 pt-2 sm:pt-0"
            >
              <button
                class="flex items-center justify-center w-9 h-9 rounded-lg text-text-2 hover:bg-primary hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-2"
                title="파일 열기"
                :disabled="!record.fileExists"
                @click="openFile(record.filePath)"
              >
                <Play :size="16" />
              </button>

              <button
                class="flex items-center justify-center w-9 h-9 rounded-lg text-text-2 hover:bg-primary hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-2"
                title="폴더에서 보기"
                :disabled="!record.fileExists"
                @click="showInFolder(record.filePath)"
              >
                <FolderOpen :size="16" />
              </button>

              <button
                v-if="record.txtExists && record.txtPath"
                class="flex items-center justify-center w-9 h-9 rounded-lg text-purple-500 hover:bg-purple-500 hover:text-white transition-all"
                title="텍스트 열기"
                @click="openFile(record.txtPath)"
              >
                <FileText :size="16" />
              </button>

              <button
                v-if="record.summaryExists && record.summaryPath"
                class="flex items-center justify-center w-9 h-9 rounded-lg text-emerald-500 hover:bg-emerald-500 hover:text-white transition-all"
                title="요약본 열기"
                @click="openFile(record.summaryPath)"
              >
                <BookOpen :size="16" />
              </button>

              <button
                class="flex items-center justify-center w-9 h-9 rounded-lg text-text-3 hover:bg-red-500/10 hover:text-red-500 transition-all"
                title="기록 삭제"
                @click="removeFromHistory(record.contentId)"
              >
                <Trash2 :size="16" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
