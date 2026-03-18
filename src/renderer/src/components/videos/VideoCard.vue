<script setup lang="ts">
import { Download, CheckCircle2, Loader2, Clock, HardDrive, Calendar } from 'lucide-vue-next'
import { computed } from 'vue'
import type { VideoItem } from '../../types'

const props = defineProps<{
  video: VideoItem
  isDownloading: boolean
  progress: number | undefined
  formatDuration: (seconds: number) => string
  formatSize: (bytes: number) => string
}>()

const emit = defineEmits<{
  download: [video: VideoItem]
}>()

const isComplete = computed(() => !props.isDownloading && props.progress === 100)
</script>

<template>
  <div class="group flex items-stretch gap-5 p-4 pr-6 border border-border/60 rounded-[24px] bg-surface transition-all duration-300 hover:border-primary/40 hover:shadow-md hover:shadow-primary/5 relative overflow-hidden">
    <!-- Background Progress Bar -->
    <div 
      v-if="isDownloading" 
      class="absolute inset-0 bg-primary/5 transition-all duration-300 ease-out z-0"
      :style="{ width: `${progress || 0}%` }"
    ></div>

    <!-- Thumbnail -->
    <div class="relative z-10 w-40 h-24 rounded-2xl overflow-hidden bg-surface-mute flex-shrink-0 shadow-sm border border-border/50">
      <img
        v-if="video.thumbnailUrl"
        :src="video.thumbnailUrl"
        class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        alt="thumbnail"
      />
      <div v-else class="w-full h-full flex items-center justify-center text-text-3 text-xs font-bold tracking-wider opacity-50 uppercase">
        No Preview
      </div>
    </div>

    <!-- Info -->
    <div class="relative z-10 flex-1 min-w-0 flex flex-col justify-center py-1">
      <div class="text-[17px] font-black text-text-1 truncate mb-2 group-hover:text-primary transition-colors tracking-tight">
        {{ video.title }}
      </div>
      <div class="flex flex-wrap items-center gap-4 text-xs text-text-3 font-semibold">
        <span class="flex items-center gap-1.5 bg-surface-mute px-2 py-1 rounded-lg text-text-2">
          <Calendar :size="13" class="text-primary" />
          {{ video.weekPosition }}주차
        </span>
        <span class="flex items-center gap-1.5">
          <Clock :size="13" class="opacity-70" />
          {{ formatDuration(video.duration) }}
        </span>
        <span class="flex items-center gap-1.5">
          <HardDrive :size="13" class="opacity-70" />
          {{ formatSize(video.fileSize) }}
        </span>
      </div>
    </div>

    <!-- Actions -->
    <div class="relative z-10 flex items-center pl-4 border-l border-border/50 ml-2">
      <div v-if="isComplete" class="flex flex-col items-center justify-center gap-1.5 text-success px-5 min-w-[100px]">
        <CheckCircle2 :size="28" class="drop-shadow-sm" />
        <span class="text-[11px] font-black uppercase tracking-widest">Done</span>
      </div>
      
      <div v-else-if="isDownloading" class="flex flex-col items-center justify-center gap-1 px-5 min-w-[100px]">
        <div class="relative flex items-center justify-center w-12 h-12">
          <svg class="w-full h-full transform -rotate-90">
            <circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="4" fill="none" class="text-surface-mute" />
            <circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="4" fill="none" class="text-primary transition-all duration-300 shadow-sm" :stroke-dasharray="2 * Math.PI * 20" :stroke-dashoffset="2 * Math.PI * 20 * (1 - (progress || 0) / 100)" stroke-linecap="round" />
          </svg>
          <span class="absolute text-[11px] font-black text-text-1 tracking-tighter">{{ Math.round(progress || 0) }}%</span>
        </div>
      </div>
      
      <button
        v-else
        class="w-12 h-12 flex items-center justify-center rounded-2xl bg-surface-mute text-text-2 hover:bg-primary hover:text-white transition-all duration-300 cursor-pointer shadow-sm hover:shadow-lg hover:shadow-primary/20 hover:-translate-y-0.5"
        @click="emit('download', video)"
        title="다운로드"
      >
        <Download :size="20" />
      </button>
    </div>
  </div>
</template>
