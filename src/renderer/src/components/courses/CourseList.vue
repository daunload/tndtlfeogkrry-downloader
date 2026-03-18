<script setup lang="ts">
import { RefreshCw, LogIn, Loader2, BookOpen } from 'lucide-vue-next'
import type { CourseItem } from '../../types'
import CourseCard from './CourseCard.vue'

defineProps<{
  courses: CourseItem[]
  isLoading: boolean
}>()

const emit = defineEmits<{
  refresh: []
  relogin: []
  select: [course: CourseItem]
}>()
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex justify-between items-end mb-10">
      <div>
        <h2 class="text-3xl font-black text-text-1 flex items-center gap-3 tracking-tight">
          <BookOpen class="text-primary" :size="32" />
          내 강의 목록
        </h2>
        <p class="text-[15px] text-text-3 mt-2 font-medium">다운로드할 과목을 선택하여 강의 영상을 확인하세요.</p>
      </div>

      <div class="flex items-center gap-4">
        <button
          class="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-border bg-surface text-sm font-semibold text-text-2 hover:bg-surface-mute hover:text-text-1 transition-all shadow-sm focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
          @click="emit('relogin')"
        >
          <LogIn :size="18" />
          재로그인
        </button>
        <button
          class="flex items-center gap-2 px-6 py-2.5 rounded-xl border-none text-sm font-bold cursor-pointer bg-primary text-white hover:bg-primary-hover shadow-md shadow-primary/20 transition-all hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
          :disabled="isLoading"
          @click="emit('refresh')"
        >
          <Loader2 v-if="isLoading" :size="18" class="animate-spin" />
          <RefreshCw v-else :size="18" />
          목록 새로고침
        </button>
      </div>
    </div>

    <!-- Empty State -->
    <div v-if="!isLoading && courses.length === 0" class="flex-1 flex flex-col items-center justify-center text-text-3 py-20">
      <div class="w-24 h-24 rounded-3xl bg-surface-mute flex items-center justify-center mb-6 shadow-inner">
        <BookOpen :size="40" class="text-text-3 opacity-50" />
      </div>
      <p class="text-xl font-bold text-text-2">수강 중인 과목이 없습니다.</p>
      <p class="text-sm mt-2 font-medium opacity-70">LMS에 과목이 정상적으로 등록되어 있는지 확인해주세요.</p>
    </div>

    <!-- Course Grid -->
    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-12">
      <CourseCard
        v-for="course in courses"
        :key="course.id"
        :course="course"
        @select="emit('select', $event)"
      />
    </div>
  </div>
</template>
