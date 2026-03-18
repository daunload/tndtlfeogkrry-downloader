<script setup lang="ts">
import { LogIn, MonitorPlay } from 'lucide-vue-next';

const emit = defineEmits<{
  login: [];
}>();
</script>

<template>
  <div class="h-full flex flex-col items-center justify-center -mt-8 sm:-mt-16 py-10 px-4">
    <div class="w-20 h-20 sm:w-28 sm:h-28 bg-primary/10 rounded-[24px] sm:rounded-[32px] flex items-center justify-center mb-8 sm:mb-12 shadow-sm border border-primary/5">
      <MonitorPlay :size="40" class="text-primary sm:hidden" />
      <MonitorPlay :size="56" class="text-primary hidden sm:block" />
    </div>

    <h2 class="text-3xl sm:text-5xl font-black text-text-1 mb-6 sm:mb-10 tracking-tighter text-center leading-tight">숭실 LMS 다운로더</h2>
    <p class="text-text-2 text-center max-w-2xl mb-12 sm:mb-20 text-base sm:text-xl leading-relaxed font-medium opacity-70">
      Canvas LMS에 로그인하여 수강 중인 과목의 강의 비디오를<br class="hidden sm:block" />
      데스크톱으로 쉽고 빠르게 다운로드하세요.
    </p>

    <button
      class="group flex items-center gap-3 px-8 sm:px-10 py-3.5 sm:py-4.5 rounded-2xl border-none text-base sm:text-lg font-bold cursor-pointer bg-primary text-white hover:bg-primary-hover shadow-md hover:shadow-lg transition-all duration-300 hover:-translate-y-1 focus-visible:ring-4 focus-visible:ring-primary/30 focus-visible:outline-none"
      @click="emit('login')"
    >
      <LogIn :size="20" class="group-hover:scale-110 transition-transform" />
      LMS 시스템 로그인
    </button>
  </div>
</template>
