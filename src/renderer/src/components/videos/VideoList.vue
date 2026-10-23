<script setup lang="ts">
import { ref, computed } from 'vue';
import {
  ArrowLeft,
  Download,
  Loader2,
  PlaySquare,
  FileText,
  Film,
  Music,
  FolderOpen,
  X,
  ChevronDown,
  CheckSquare,
  Square,
  Check,
  Cloud
} from 'lucide-vue-next';
import { toSafeFileName } from '../../../../shared/config';
import type { VideoItem } from '../../types';
import type { TranscribeStatus } from '../../composables/useTranscriber';
import VideoCard from './VideoCard.vue';

const props = defineProps<{
  videos: VideoItem[];
  isLoading: boolean;
  isDownloadingAll: boolean;
  downloadingIds: Set<string>;
  progressMap: Record<string, number>;
  statusMap: Record<string, { status: string; splitCurrent?: number; splitTotal?: number }>;
  formatDuration: (seconds: number) => string;
  formatSize: (bytes: number) => string;
  /** 텍스트 변환 가능 여부 (Gemini 키 설정 또는 Whisper 엔진) */
  hasApiKey?: boolean;
  /** 요약본 생성 가능 여부 (요약은 Gemini API 키 필요) */
  canSummarize?: boolean;
  /** File API 옵션 표시 여부 (Gemini 엔진 전용) */
  showFileApi?: boolean;
  isTranscribing?: boolean;
  isTranscribingBatch?: boolean;
  transcribeProgressMap?: Record<string, number>;
  transcribeStatusMap?: Record<string, TranscribeStatus>;
  transcribeBatchProgress?: { completed: number; total: number } | null;
  transcriptPaths?: Record<string, string>;
  downloadFolder?: string | null;
  historyContentIds?: Set<string>;
}>();

const withSummary = defineModel<boolean>('withSummary', { required: true });
const useFileApi = defineModel<boolean>('useFileApi', { required: true });

const emit = defineEmits<{
  back: [];
  downloadAll: [format: 'mp4' | 'mp3'];
  downloadSelected: [videos: VideoItem[], format: 'mp4' | 'mp3'];
  download: [video: VideoItem];
  transcribe: [video: VideoItem];
  openText: [txtPath: string];
  transcribeAll: [];
  transcribeSelected: [videos: VideoItem[]];
  selectFolder: [];
  clearFolder: [];
}>();

// 선택 상태
const selectedIds = ref<Set<string>>(new Set());
const showDropdown = ref(false);

const selectedCount = computed(() => selectedIds.value.size);
const availableVideos = computed(() => props.videos.filter((v) => v.available !== false));
const isAllSelected = computed(
  () => availableVideos.value.length > 0 && selectedIds.value.size === availableVideos.value.length
);
const selectedVideos = computed(() =>
  props.videos.filter((v) => selectedIds.value.has(v.contentId))
);

/**
 * 변환 진행 이벤트는 파일명(안전한 이름 + 확장자)으로 오므로 여러 후보 키로 조회한다.
 * mp4를 직접 변환하는 경우 `.mp4` 이름으로 이벤트가 온다.
 */
function transcribeKeys(video: VideoItem): string[] {
  const safe = toSafeFileName(video.title);
  return [`${safe}.mp3`, `${safe}.mp4`, `${video.title}.mp3`, video.title];
}

function getTranscribeProgress(video: VideoItem): number | undefined {
  for (const key of transcribeKeys(video)) {
    const value = props.transcribeProgressMap?.[key];
    if (value !== undefined) return value;
  }
  return undefined;
}

function getTranscribeStatus(video: VideoItem): TranscribeStatus | undefined {
  for (const key of transcribeKeys(video)) {
    const value = props.transcribeStatusMap?.[key];
    if (value) return value;
  }
  return undefined;
}

/** 일괄 다운로드+변환은 downloadingIds를 쓰지 않으므로 진행률(0~99)로도 다운로드 중 여부를 판단 */
function isVideoDownloading(video: VideoItem): boolean {
  if (props.downloadingIds.has(video.contentId)) return true;
  const progress = props.progressMap[video.contentId];
  return progress !== undefined && progress >= 0 && progress < 100;
}

const ACTIVE_TRANSCRIBE_STATUSES = [
  'converting',
  'loading-model',
  'uploading',
  'transcribing',
  'merging'
];

const downloadingCount = computed(() => props.videos.filter(isVideoDownloading).length);
const transcribingCount = computed(
  () =>
    props.videos.filter((v) =>
      ACTIVE_TRANSCRIBE_STATUSES.includes(getTranscribeStatus(v)?.status ?? '')
    ).length
);

/** 현재 진행 중인 작업 단계 표시 (다운로드 / 텍스트 변환) */
const activityLines = computed(() => {
  const lines: { kind: 'download' | 'transcribe'; text: string }[] = [];

  if (downloadingCount.value > 0) {
    const prefix = props.isTranscribingBatch ? '1단계 · ' : '';
    lines.push({
      kind: 'download',
      text: `${prefix}영상 다운로드 중 — ${downloadingCount.value}개 진행 중`
    });
  }

  if (transcribingCount.value > 0) {
    const prefix = props.isTranscribingBatch ? '2단계 · ' : '';
    const batch = props.transcribeBatchProgress;
    const batchInfo = batch ? ` (완료 ${batch.completed}/${batch.total})` : '';
    lines.push({
      kind: 'transcribe',
      text: `${prefix}텍스트 변환 중 — ${transcribingCount.value}개 진행 중${batchInfo}`
    });
  }

  // 단계 전환 사이(키 확인, 다음 파일 대기 등)에도 작업 중임을 표시
  if (lines.length === 0 && (props.isTranscribingBatch || props.isTranscribing)) {
    lines.push({ kind: 'transcribe', text: '텍스트 변환 준비 중...' });
  } else if (lines.length === 0 && props.isDownloadingAll) {
    lines.push({ kind: 'download', text: '영상 다운로드 준비 중...' });
  }

  return lines;
});

function toggleSelect(video: VideoItem): void {
  const ids = new Set(selectedIds.value);
  if (ids.has(video.contentId)) {
    ids.delete(video.contentId);
  } else {
    ids.add(video.contentId);
  }
  selectedIds.value = ids;
}

function toggleSelectAll(): void {
  if (isAllSelected.value) {
    selectedIds.value = new Set();
  } else {
    selectedIds.value = new Set(availableVideos.value.map((v) => v.contentId));
  }
}

function handleAction(action: 'download-mp4' | 'download-mp3' | 'transcribe'): void {
  showDropdown.value = false;
  const targets = selectedCount.value > 0 ? selectedVideos.value : undefined;
  if (action === 'download-mp4' || action === 'download-mp3') {
    const format = action === 'download-mp4' ? 'mp4' : 'mp3';
    if (targets) {
      emit('downloadSelected', targets, format);
    } else {
      emit('downloadAll', format);
    }
  } else {
    if (targets) {
      emit('transcribeSelected', targets);
    } else {
      emit('transcribeAll');
    }
  }
}

function closeDropdown(e: MouseEvent): void {
  const target = e.target as HTMLElement;
  if (!target.closest('.action-dropdown')) {
    showDropdown.value = false;
  }
}
</script>

<template>
  <div class="h-full flex flex-col" @click="closeDropdown">
    <!-- Header -->
    <div class="flex flex-col gap-4 mb-8">
      <div class="flex items-center gap-3 -ml-2">
        <button
          class="p-2 rounded-2xl border-none cursor-pointer bg-transparent text-text-2 hover:bg-surface-mute hover:text-text-1 transition-all shrink-0"
          title="목록으로 돌아가기"
          @click="emit('back')"
        >
          <ArrowLeft :size="24" />
        </button>

        <h2 class="text-2xl font-black text-text-1 tracking-tight whitespace-nowrap">
          강의 영상 리스트
        </h2>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <!-- 요약본 생성 체크박스 -->
        <button
          v-if="canSummarize ?? hasApiKey"
          class="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium cursor-pointer transition-all duration-200"
          :class="
            withSummary
              ? 'bg-purple-500/10 border-purple-500/30 text-purple-500'
              : 'bg-surface-mute border-border/50 text-text-3 hover:text-text-2'
          "
          @click="withSummary = !withSummary"
        >
          <div
            class="w-4 h-4 rounded border flex items-center justify-center transition-all duration-200"
            :class="
              withSummary ? 'bg-purple-500 border-purple-500' : 'bg-transparent border-text-3'
            "
          >
            <Check v-if="withSummary" :size="12" class="text-white" />
          </div>
          요약본 생성
        </button>

        <!-- File API 사용 체크박스 -->
        <button
          v-if="hasApiKey && (showFileApi ?? true)"
          class="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium cursor-pointer transition-all duration-200"
          :class="
            useFileApi
              ? 'bg-blue-500/10 border-blue-500/30 text-blue-500'
              : 'bg-surface-mute border-border/50 text-text-3 hover:text-text-2'
          "
          @click="useFileApi = !useFileApi"
        >
          <div
            class="w-4 h-4 rounded border flex items-center justify-center transition-all duration-200"
            :class="useFileApi ? 'bg-blue-500 border-blue-500' : 'bg-transparent border-text-3'"
          >
            <Check v-if="useFileApi" :size="12" class="text-white" />
          </div>
          <Cloud :size="14" />
          File API
        </button>

        <!-- 전체/해제 선택 버튼 -->
        <button
          v-if="videos.length > 0"
          class="flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-sm font-bold cursor-pointer whitespace-nowrap transition-all"
          :class="
            isAllSelected
              ? 'bg-primary/10 border-primary/30 text-primary'
              : 'bg-surface-mute border-border text-text-2 hover:bg-surface-hover hover:text-text-1'
          "
          @click="toggleSelectAll"
        >
          <CheckSquare v-if="isAllSelected" :size="16" class="text-primary" />
          <Square v-else :size="16" />
          {{ isAllSelected ? '전체 해제' : '전체 선택' }}
        </button>

        <!-- 액션 드롭다운 -->
        <div v-if="videos.length > 0" class="relative action-dropdown">
          <button
            class="flex items-center gap-2 px-5 py-2.5 rounded-2xl border-none text-sm font-bold cursor-pointer whitespace-nowrap bg-primary text-white hover:bg-primary-hover shadow-lg shadow-primary/25 transition-all hover:shadow-xl hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0"
            :disabled="isDownloadingAll || isTranscribingBatch || isLoading"
            @click.stop="showDropdown = !showDropdown"
          >
            <Loader2
              v-if="isDownloadingAll || isTranscribingBatch"
              :size="18"
              class="animate-spin"
            />
            <template v-else>
              <Download :size="18" />
              {{ selectedCount > 0 ? `선택 (${selectedCount})` : '전체' }}
              <ChevronDown
                :size="14"
                class="transition-transform"
                :class="{ 'rotate-180': showDropdown }"
              />
            </template>
          </button>

          <!-- 드롭다운 메뉴 -->
          <Transition name="dropdown">
            <div
              v-if="showDropdown"
              class="absolute top-full left-0 mt-2 w-52 bg-surface border border-border rounded-2xl shadow-xl shadow-black/10 overflow-hidden z-50"
            >
              <button
                class="w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold text-text-1 hover:bg-surface-mute transition-all cursor-pointer border-none bg-transparent text-left"
                @click="handleAction('download-mp4')"
              >
                <Film :size="16" class="text-primary shrink-0" />
                {{ selectedCount > 0 ? `${selectedCount}개 MP4 다운로드` : '전체 MP4 다운로드' }}
              </button>
              <button
                class="w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold text-text-1 hover:bg-surface-mute transition-all cursor-pointer border-none bg-transparent text-left border-t border-border/50"
                @click="handleAction('download-mp3')"
              >
                <Music :size="16" class="text-primary shrink-0" />
                {{ selectedCount > 0 ? `${selectedCount}개 MP3 다운로드` : '전체 MP3 다운로드' }}
              </button>
              <button
                v-if="hasApiKey"
                class="w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold text-text-1 hover:bg-surface-mute transition-all cursor-pointer border-none bg-transparent text-left border-t border-border/50"
                @click="handleAction('transcribe')"
              >
                <FileText :size="16" class="text-purple-500 shrink-0" />
                {{ selectedCount > 0 ? `${selectedCount}개 텍스트 변환` : '전체 텍스트 변환' }}
              </button>
            </div>
          </Transition>
        </div>
      </div>
    </div>

    <!-- Folder Selection -->
    <div class="flex items-center gap-3 mb-6 px-1 min-w-0">
      <button
        class="flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-sm font-medium cursor-pointer whitespace-nowrap bg-surface-mute text-text-2 hover:bg-surface-hover hover:text-text-1 transition-all shrink-0"
        @click="emit('selectFolder')"
      >
        <FolderOpen :size="16" />
        폴더 선택
      </button>
      <div v-if="downloadFolder" class="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
        <span class="text-sm text-text-2 truncate" :title="downloadFolder">
          {{ downloadFolder }}
        </span>
        <button
          class="p-1 rounded-lg border-none cursor-pointer bg-transparent text-text-3 hover:bg-surface-mute hover:text-text-1 transition-all shrink-0"
          title="폴더 선택 해제"
          @click="emit('clearFolder')"
        >
          <X :size="14" />
        </button>
      </div>
      <span v-else class="text-sm text-text-3 truncate">
        폴더를 선택하지 않으면 다운로드 시 매번 선택합니다
      </span>
    </div>

    <!-- 진행 중인 작업 상태 -->
    <div
      v-if="activityLines.length > 0"
      class="flex flex-col gap-2 mb-6 px-4 py-3 rounded-2xl border border-border/60 bg-surface"
      role="status"
      aria-live="polite"
    >
      <div
        v-for="line in activityLines"
        :key="line.kind"
        class="flex items-center gap-2.5 text-sm font-semibold"
        :class="line.kind === 'download' ? 'text-primary' : 'text-purple-500'"
      >
        <Loader2 :size="16" class="animate-spin shrink-0" />
        <Download v-if="line.kind === 'download'" :size="14" class="shrink-0" />
        <FileText v-else :size="14" class="shrink-0" />
        <span class="truncate">{{ line.text }}</span>
      </div>
    </div>

    <!-- Empty State -->
    <div
      v-if="!isLoading && videos.length === 0"
      class="flex-1 flex flex-col items-center justify-center text-text-3 py-20"
    >
      <div
        class="w-24 h-24 rounded-3xl bg-surface-mute flex items-center justify-center mb-6 shadow-inner"
      >
        <PlaySquare :size="40" class="text-text-3 opacity-50" />
      </div>
      <p class="text-xl font-bold text-text-2">다운로드할 영상이 없습니다.</p>
      <p class="text-sm mt-2 font-medium opacity-70">
        이 과목에 업로드된 영상이 있는지 확인해주세요.
      </p>
    </div>

    <!-- Video List -->
    <div v-else class="flex flex-col gap-4 pb-12">
      <VideoCard
        v-for="video in videos"
        :key="video.contentId"
        :video="video"
        :is-downloading="isVideoDownloading(video)"
        :progress="progressMap[video.contentId]"
        :status="statusMap[video.contentId]"
        :format-duration="formatDuration"
        :format-size="formatSize"
        :has-api-key="hasApiKey"
        :selected="selectedIds.has(video.contentId)"
        :is-in-history="historyContentIds?.has(video.contentId) ?? false"
        :transcribe-progress="getTranscribeProgress(video)"
        :transcribe-status="getTranscribeStatus(video)"
        :transcript-path="transcriptPaths?.[video.contentId]"
        @download="emit('download', $event)"
        @transcribe="emit('transcribe', $event)"
        @open-text="emit('openText', $event)"
        @toggle-select="toggleSelect"
      />
    </div>
  </div>
</template>

<style scoped>
.dropdown-enter-active {
  transition: all 0.15s ease-out;
}
.dropdown-leave-active {
  transition: all 0.1s ease-in;
}
.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.97);
}
</style>
