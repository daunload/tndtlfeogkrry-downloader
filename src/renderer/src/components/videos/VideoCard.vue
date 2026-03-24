<script setup lang="ts">
import {
  Download,
  CheckCircle2,
  Loader2,
  Clock,
  HardDrive,
  Calendar,
  FileText,
  Check,
  Lock
} from 'lucide-vue-next';
import type { TranscribeStatus } from '../../composables/useTranscriber';
import { computed } from 'vue';
import type { VideoItem } from '../../types';

const props = defineProps<{
  video: VideoItem;
  isDownloading: boolean;
  progress: number | undefined;
  status?: { status: string; splitCurrent?: number; splitTotal?: number };
  formatDuration: (seconds: number) => string;
  formatSize: (bytes: number) => string;
  hasApiKey?: boolean;
  transcribeProgress?: number;
  transcribeStatus?: TranscribeStatus;
  selected?: boolean;
  isInHistory?: boolean;
}>();

const emit = defineEmits<{
  download: [video: VideoItem];
  transcribe: [video: VideoItem];
  toggleSelect: [video: VideoItem];
}>();

const isComplete = computed(() => !props.isDownloading && props.progress === 100);

const statusLabel = computed(() => {
  if (!props.status) return null;
  if (props.status.status === 'converting') return 'MP3 변환 중...';
  if (props.status.status === 'splitting')
    return `MP3 분할 중 (${props.status.splitCurrent}/${props.status.splitTotal})`;
  if (props.status.status === 'split-done') return `${props.status.splitTotal}개 파일로 분할 완료`;
  return null;
});

const transcribeLabel = computed(() => {
  if (!props.transcribeStatus) return null;
  if (props.transcribeStatus.status === 'converting') return 'MP3 변환 중...';
  if (props.transcribeStatus.status === 'uploading') {
    if (props.transcribeStatus.totalParts && props.transcribeStatus.totalParts > 1) {
      return `파일 업로드 중 (${props.transcribeStatus.currentPart}/${props.transcribeStatus.totalParts})`;
    }
    return '파일 업로드 중...';
  }
  if (props.transcribeStatus.status === 'transcribing') {
    if (props.transcribeStatus.totalParts && props.transcribeStatus.totalParts > 1) {
      return `텍스트 변환 중 (${props.transcribeStatus.currentPart}/${props.transcribeStatus.totalParts})`;
    }
    return '텍스트 변환 중...';
  }
  if (props.transcribeStatus.status === 'merging') return '파트 병합 중...';
  if (props.transcribeStatus.status === 'done') return '변환 완료';
  if (props.transcribeStatus.status === 'error') return '변환 실패';
  return null;
});

const isTranscribing = computed(
  () =>
    props.transcribeStatus?.status === 'converting' ||
    props.transcribeStatus?.status === 'uploading' ||
    props.transcribeStatus?.status === 'transcribing' ||
    props.transcribeStatus?.status === 'merging'
);

const isTranscribeDone = computed(() => props.transcribeStatus?.status === 'done');
</script>

<template>
  <div
    class="group flex flex-col sm:flex-row items-stretch gap-4 sm:gap-5 p-4 sm:pr-6 border border-border/60 rounded-[20px] sm:rounded-[24px] bg-surface transition-all duration-300 relative overflow-hidden"
    :class="{
      'border-primary/60 bg-primary/5': selected,
      'opacity-50 cursor-not-allowed': video.available === false,
      'hover:border-primary/40 hover:shadow-md hover:shadow-primary/5': video.available !== false
    }"
  >
    <!-- Background Progress Bar -->
    <div
      v-if="isDownloading"
      class="absolute inset-0 bg-primary/5 transition-all duration-300 ease-out z-0"
      :style="{ width: `${progress || 0}%` }"
    ></div>

    <!-- Checkbox -->
    <button
      v-if="video.available !== false"
      class="relative z-10 hidden sm:flex items-center justify-center shrink-0 w-6 h-6 my-auto rounded-md border-2 cursor-pointer transition-all duration-200"
      :class="
        selected
          ? 'bg-primary border-primary text-white'
          : 'bg-transparent border-border hover:border-primary/60 text-transparent'
      "
      @click="emit('toggleSelect', video)"
    >
      <Check v-if="selected" :size="14" :stroke-width="3" />
    </button>

    <!-- Info -->
    <div class="relative z-10 flex-1 min-w-0 flex flex-col justify-center py-0 sm:py-1">
      <div
        class="text-base sm:text-[17px] font-black text-text-1 truncate mb-2 group-hover:text-primary transition-colors tracking-tight"
      >
        {{ video.title }}
      </div>
      <div
        class="flex flex-wrap items-center gap-3 sm:gap-4 text-[10px] sm:text-xs text-text-3 font-semibold"
      >
        <span
          class="flex items-center gap-1.5 bg-surface-mute px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg text-text-2"
        >
          <Calendar :size="12" class="text-primary" />
          {{ video.weekPosition }}주차
        </span>
        <span class="flex items-center gap-1.5">
          <Clock :size="12" class="opacity-70" />
          {{ formatDuration(video.duration) }}
        </span>
        <span class="flex items-center gap-1.5">
          <HardDrive :size="12" class="opacity-70" />
          {{ formatSize(video.fileSize) }}
        </span>
      </div>
    </div>

    <!-- Actions -->
    <div
      class="relative z-10 flex items-center justify-end sm:justify-center gap-3 sm:gap-2 pl-0 sm:pl-4 border-t sm:border-t-0 sm:border-l border-border/50 mt-3 sm:mt-0 pt-3 sm:pt-0 sm:ml-2"
    >
      <div
        v-if="isComplete"
        class="flex flex-row sm:flex-col items-center justify-center gap-1.5 px-2 sm:px-3 min-w-0 sm:min-w-[80px]"
      >
        <CheckCircle2 :size="24" sm:size="28" class="text-success drop-shadow-sm" />
        <span class="hidden sm:block text-[11px] font-black uppercase tracking-widest text-success"
          >Done</span
        >
        <span v-if="status?.status === 'split-done'" class="text-[10px] font-semibold text-text-3"
          >{{ status.splitTotal }}개 분할</span
        >
      </div>

      <div
        v-else-if="isDownloading"
        class="flex flex-col items-center justify-center gap-1 px-2 sm:px-3 min-w-0 sm:min-w-[80px]"
      >
        <div class="relative flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12">
          <svg class="w-full h-full transform -rotate-90">
            <circle
              cx="20"
              cy="20"
              r="16"
              stroke="currentColor"
              stroke-width="3"
              fill="none"
              class="text-surface-mute sm:hidden"
            />
            <circle
              cx="24"
              cy="24"
              r="20"
              stroke="currentColor"
              stroke-width="4"
              fill="none"
              class="text-surface-mute hidden sm:block"
            />
            <circle
              cx="20"
              cy="20"
              r="16"
              stroke="currentColor"
              stroke-width="3"
              fill="none"
              class="text-primary transition-all duration-300 sm:hidden"
              :stroke-dasharray="2 * Math.PI * 16"
              :stroke-dashoffset="2 * Math.PI * 16 * (1 - (progress || 0) / 100)"
              stroke-linecap="round"
            />
            <circle
              cx="24"
              cy="24"
              r="20"
              stroke="currentColor"
              stroke-width="4"
              fill="none"
              class="text-primary transition-all duration-300 shadow-sm hidden sm:block"
              :stroke-dasharray="2 * Math.PI * 20"
              :stroke-dashoffset="2 * Math.PI * 20 * (1 - (progress || 0) / 100)"
              stroke-linecap="round"
            />
          </svg>
          <span class="absolute text-[10px] sm:text-[11px] font-black text-text-1 tracking-tighter"
            >{{ Math.round(progress || 0) }}%</span
          >
        </div>
        <span
          v-if="statusLabel"
          class="hidden sm:block text-[10px] font-semibold text-text-3 text-center whitespace-nowrap"
          >{{ statusLabel }}</span
        >
      </div>

      <div
        v-else-if="video.available === false"
        class="flex flex-row sm:flex-col items-center justify-center gap-1.5 px-2 sm:px-3 min-w-0 sm:min-w-[80px]"
        title="아직 공개되지 않은 콘텐츠입니다"
      >
        <Lock :size="20" sm:size="24" class="text-text-3" />
        <span class="hidden sm:block text-[10px] font-bold text-text-3 whitespace-nowrap"
          >미공개</span
        >
      </div>

      <div v-else class="relative">
        <button
          class="w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center rounded-xl sm:rounded-2xl bg-surface-mute text-text-2 hover:bg-primary hover:text-white transition-all duration-300 cursor-pointer shadow-sm hover:shadow-lg"
          :title="isInHistory ? '다운로드 (이미 받은 영상)' : '다운로드'"
          @click="emit('download', video)"
        >
          <Download :size="18" sm:size="20" />
        </button>
        <!-- 이미 다운로드한 영상 뱃지 -->
        <div
          v-if="isInHistory"
          class="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-success flex items-center justify-center shadow-sm"
          title="이미 다운로드한 영상"
        >
          <Check :size="10" :stroke-width="3" class="text-white" />
        </div>
      </div>

      <!-- 텍스트 변환 버튼 -->
      <template v-if="isComplete && hasApiKey">
        <div
          v-if="isTranscribeDone"
          class="flex flex-row sm:flex-col items-center justify-center gap-1 px-2 sm:px-3 min-w-0 sm:min-w-[60px]"
        >
          <FileText :size="20" sm:size="24" class="text-purple-500" />
          <span class="hidden sm:block text-[10px] font-bold text-purple-500 whitespace-nowrap"
            >변환됨</span
          >
        </div>

        <div
          v-else-if="isTranscribing"
          class="flex flex-col items-center justify-center gap-1 px-2 sm:px-3 min-w-0 sm:min-w-[60px]"
        >
          <div class="relative flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10">
            <svg class="w-full h-full transform -rotate-90">
              <circle
                cx="16"
                cy="16"
                r="13"
                stroke="currentColor"
                stroke-width="2"
                fill="none"
                class="text-surface-mute sm:hidden"
              />
              <circle
                cx="20"
                cy="20"
                r="16"
                stroke="currentColor"
                stroke-width="3"
                fill="none"
                class="text-surface-mute hidden sm:block"
              />
              <circle
                cx="16"
                cy="16"
                r="13"
                stroke="currentColor"
                stroke-width="2"
                fill="none"
                class="text-purple-500 transition-all duration-300 sm:hidden"
                :stroke-dasharray="2 * Math.PI * 13"
                :stroke-dashoffset="2 * Math.PI * 13 * (1 - (transcribeProgress || 0) / 100)"
                stroke-linecap="round"
              />
              <circle
                cx="20"
                cy="20"
                r="16"
                stroke="currentColor"
                stroke-width="3"
                fill="none"
                class="text-purple-500 transition-all duration-300 hidden sm:block"
                :stroke-dasharray="2 * Math.PI * 16"
                :stroke-dashoffset="2 * Math.PI * 16 * (1 - (transcribeProgress || 0) / 100)"
                stroke-linecap="round"
              />
            </svg>
            <Loader2 :size="12" sm:size="14" class="absolute text-purple-500 animate-spin" />
          </div>
          <span
            v-if="transcribeLabel"
            class="hidden sm:block text-[9px] font-semibold text-text-3 text-center whitespace-nowrap"
            >{{ transcribeLabel }}</span
          >
        </div>

        <button
          v-else
          class="w-10 h-10 sm:w-10 sm:h-10 flex items-center justify-center rounded-xl bg-purple-500/10 text-purple-500 hover:bg-purple-500 hover:text-white transition-all duration-300 cursor-pointer shadow-sm hover:shadow-lg"
          title="텍스트 변환"
          @click="emit('transcribe', video)"
        >
          <FileText :size="18" />
        </button>
      </template>
    </div>
  </div>
</template>
