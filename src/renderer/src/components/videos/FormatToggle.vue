<script setup lang="ts">
import { Film, Music } from 'lucide-vue-next'

const model = defineModel<'mp4' | 'mp3'>({ required: true })
</script>

<template>
  <div class="flex p-1 rounded-xl bg-surface-mute border border-border/50">
    <button
      class="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border-none cursor-pointer transition-all duration-200"
      :class="model === 'mp4'
        ? 'bg-surface text-text-1 shadow-sm'
        : 'bg-transparent text-text-3 hover:text-text-2'"
      @click="model = 'mp4'"
    >
      <Film :size="16" :class="model === 'mp4' ? 'text-primary' : ''" />
      MP4
    </button>
    <button
      class="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border-none cursor-pointer transition-all duration-200"
      :class="model === 'mp3'
        ? 'bg-surface text-text-1 shadow-sm'
        : 'bg-transparent text-text-3 hover:text-text-2'"
      @click="model = 'mp3'"
    >
      <Music :size="16" :class="model === 'mp3' ? 'text-primary' : ''" />
      MP3
    </button>
  </div>
</template>
