<script setup lang="ts">
import { ArrowLeft, Download, Loader2, PlaySquare } from 'lucide-vue-next'
import type { VideoItem } from '../../types'
import FormatToggle from './FormatToggle.vue'
import VideoCard from './VideoCard.vue'

defineProps<{
  videos: VideoItem[]
  isLoading: boolean
  isDownloadingAll: boolean
  downloadingIds: Set<string>
  progressMap: Record<string, number>
  formatDuration: (seconds: number) => string
  formatSize: (bytes: number) => string
}>()

const downloadFormat = defineModel<'mp4' | 'mp3'>('downloadFormat', { required: true })

const emit = defineEmits<{
  back: []
  downloadAll: []
  download: [video: VideoItem]
}>()
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Header -->
    <div class="flex items-center gap-5 mb-10">
      <button
        class="p-3 -ml-3 rounded-2xl border-none cursor-pointer bg-transparent text-text-2 hover:bg-surface-mute hover:text-text-1 transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
        @click="emit('back')"
        title="목록으로 돌아가기"
      >
        <ArrowLeft :size="28" />
      </button>
      
      <div class="flex-1">
        <h2 class="text-3xl font-black text-text-1 tracking-tight">
          강의 영상 리스트
        </h2>
      </div>

      <div class="flex items-center gap-4">
        <FormatToggle v-model="downloadFormat" />
        <button
          v-if="videos.length > 0"
          class="flex items-center gap-2.5 px-6 py-3 rounded-2xl border-none text-sm font-bold cursor-pointer bg-primary text-white hover:bg-primary-hover shadow-lg shadow-primary/25 transition-all hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
          :disabled="isDownloadingAll || isLoading"
          @click="emit('downloadAll')"
        >
          <Loader2 v-if="isDownloadingAll" :size="18" class="animate-spin" />
          <Download v-else :size="18" />
          {{ isDownloadingAll ? '전체 다운로드 중...' : '전체 다운로드' }}
        </button>
      </div>
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
        :format-duration="formatDuration"
        :format-size="formatSize"
        @download="emit('download', $event)"
      />
    </div>
  </div>
</template>
