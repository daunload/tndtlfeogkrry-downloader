<script setup lang="ts">
import { ArrowLeft, Download, Loader2, PlaySquare, FileText, FolderOpen, X } from 'lucide-vue-next'
import type { VideoItem } from '../../types'
import type { TranscribeStatus } from '../../composables/useTranscriber'
import FormatToggle from './FormatToggle.vue'
import VideoCard from './VideoCard.vue'

defineProps<{
  videos: VideoItem[]
  isLoading: boolean
  isDownloadingAll: boolean
  downloadingIds: Set<string>
  progressMap: Record<string, number>
  statusMap: Record<string, { status: string; splitCurrent?: number; splitTotal?: number }>
  formatDuration: (seconds: number) => string
  formatSize: (bytes: number) => string
  hasApiKey?: boolean
  isTranscribingBatch?: boolean
  transcribeProgressMap?: Record<string, number>
  transcribeStatusMap?: Record<string, TranscribeStatus>
  downloadFolder?: string | null
}>()

const downloadFormat = defineModel<'mp4' | 'mp3'>('downloadFormat', { required: true })

const emit = defineEmits<{
  back: []
  downloadAll: []
  download: [video: VideoItem]
  transcribe: [video: VideoItem]
  transcribeAll: []
  selectFolder: []
  clearFolder: []
}>()
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Header -->
    <div class="flex flex-col gap-4 mb-8">
      <div class="flex items-center gap-3 -ml-2">
        <button
          class="p-2 rounded-2xl border-none cursor-pointer bg-transparent text-text-2 hover:bg-surface-mute hover:text-text-1 transition-all shrink-0"
          @click="emit('back')"
          title="목록으로 돌아가기"
        >
          <ArrowLeft :size="24" />
        </button>

        <h2 class="text-2xl font-black text-text-1 tracking-tight whitespace-nowrap">
          강의 영상 리스트
        </h2>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <FormatToggle v-model="downloadFormat" />
        <button
          v-if="videos.length > 0"
          class="flex items-center gap-2 px-5 py-2.5 rounded-2xl border-none text-sm font-bold cursor-pointer whitespace-nowrap bg-primary text-white hover:bg-primary-hover shadow-lg shadow-primary/25 transition-all hover:shadow-xl hover:-translate-y-0.5"
          :disabled="isDownloadingAll || isLoading"
          @click="emit('downloadAll')"
        >
          <Loader2 v-if="isDownloadingAll" :size="18" class="animate-spin" />
          <Download v-else :size="18" />
          {{ isDownloadingAll ? '다운로드 중...' : '전체 다운로드' }}
        </button>
        <button
          v-if="videos.length > 0 && hasApiKey"
          class="flex items-center gap-2 px-5 py-2.5 rounded-2xl border-none text-sm font-bold cursor-pointer whitespace-nowrap bg-purple-500 text-white hover:bg-purple-600 shadow-lg shadow-purple-500/25 transition-all hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0 focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:outline-none"
          :disabled="isTranscribingBatch || isLoading"
          @click="emit('transcribeAll')"
        >
          <Loader2 v-if="isTranscribingBatch" :size="18" class="animate-spin" />
          <FileText v-else :size="18" />
          {{ isTranscribingBatch ? '변환 중...' : '전체 텍스트 변환' }}
        </button>
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
          @click="emit('clearFolder')"
          title="폴더 선택 해제"
        >
          <X :size="14" />
        </button>
      </div>
      <span v-else class="text-sm text-text-3 truncate">
        폴더를 선택하지 않으면 다운로드 시 매번 선택합니다
      </span>
    </div>

    <!-- Empty State -->
    <div v-if="!isLoading && videos.length === 0" class="flex-1 flex flex-col items-center justify-center text-text-3 py-20">
      <div class="w-24 h-24 rounded-3xl bg-surface-mute flex items-center justify-center mb-6 shadow-inner">
        <PlaySquare :size="40" class="text-text-3 opacity-50" />
      </div>
      <p class="text-xl font-bold text-text-2">다운로드할 영상이 없습니다.</p>
      <p class="text-sm mt-2 font-medium opacity-70">이 과목에 업로드된 영상이 있는지 확인해주세요.</p>
    </div>

    <!-- Video List -->
    <div v-else class="flex flex-col gap-4 pb-12">
      <VideoCard
        v-for="video in videos"
        :key="video.contentId"
        :video="video"
        :is-downloading="downloadingIds.has(video.contentId)"
        :progress="progressMap[video.contentId]"
        :status="statusMap[video.contentId]"
        :format-duration="formatDuration"
        :format-size="formatSize"
        :has-api-key="hasApiKey"
        :transcribe-progress="transcribeProgressMap?.[video.title + '.mp3'] ?? transcribeProgressMap?.[video.title]"
        :transcribe-status="transcribeStatusMap?.[video.title + '.mp3'] ?? transcribeStatusMap?.[video.title]"
        @download="emit('download', $event)"
        @transcribe="emit('transcribe', $event)"
      />
    </div>
  </div>
</template>
