<script setup lang="ts">
import { Sun, Moon } from 'lucide-vue-next'
import { useTheme } from '../../composables/useTheme'

const { isDark, toggleTheme } = useTheme()
</script>

<template>
  <div class="flex items-center justify-between mb-5">
    <h1 class="text-xl font-semibold text-text-1">숭실 LMS 비디오 다운로더</h1>
    <button
      class="p-2 rounded-lg border-none cursor-pointer bg-surface-mute text-text-2 hover:text-text-1 transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
      @click="toggleTheme"
      :title="isDark ? '라이트 모드' : '다크 모드'"
    >
      <Moon v-if="isDark" :size="18" />
      <Sun v-else :size="18" />
    </button>
  </div>
</template>
