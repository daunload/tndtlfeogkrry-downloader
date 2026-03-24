<script setup lang="ts">
import { RefreshCw, LogIn, Loader2 } from 'lucide-vue-next';
import type { CourseItem } from '../../types';
import CourseCard from './CourseCard.vue';

defineProps<{
  courses: CourseItem[];
  isLoading: boolean;
}>();

const emit = defineEmits<{
  refresh: [];
  relogin: [];
  select: [course: CourseItem];
}>();
</script>

<template>
  <div class="h-full flex flex-col">
    <div
      class="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-6 gap-4"
    >
      <div>
        <h2 class="text-xl sm:text-2xl font-bold text-text-1 tracking-tight">
          내 강의 목록
        </h2>
        <p class="text-sm text-text-3 mt-1 font-medium">
          다운로드할 과목을 선택하세요.
        </p>
      </div>

      <div class="flex items-center gap-3 w-full sm:w-auto">
        <button
          class="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border bg-surface text-sm font-semibold text-text-2 hover:bg-surface-mute hover:text-text-1 transition-all"
          @click="emit('relogin')"
        >
          <LogIn :size="16" />
          <span class="whitespace-nowrap">재로그인</span>
        </button>
        <button
          class="flex-[2] sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-lg border-none text-sm font-bold cursor-pointer bg-primary text-white hover:bg-primary-hover transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          :disabled="isLoading"
          @click="emit('refresh')"
        >
          <Loader2 v-if="isLoading" :size="16" class="animate-spin" />
          <RefreshCw v-else :size="16" />
          <span class="whitespace-nowrap">새로고침</span>
        </button>
      </div>
    </div>

    <!-- Empty State -->
    <div
      v-if="!isLoading && courses.length === 0"
      class="flex-1 flex flex-col items-center justify-center text-text-3 py-16"
    >
      <p class="text-lg font-bold text-text-2">수강 중인 과목이 없습니다.</p>
      <p class="text-sm mt-1.5 font-medium opacity-70">
        LMS에 과목이 정상적으로 등록되어 있는지 확인해주세요.
      </p>
    </div>

    <!-- Course List -->
    <div v-else class="flex flex-col gap-2 pb-8">
      <CourseCard
        v-for="course in courses"
        :key="course.id"
        :course="course"
        @select="emit('select', $event)"
      />
    </div>
  </div>
</template>
