<script setup lang="ts">
import { LogIn, MonitorPlay } from 'lucide-vue-next';

const emit = defineEmits<{
  login: [];
}>();
</script>

<template>
  <div class="h-full flex flex-col items-center justify-center -mt-16">
    <div
      class="w-28 h-28 bg-primary/10 rounded-[32px] flex items-center justify-center mb-12 shadow-sm border border-primary/5"
    >
      <MonitorPlay :size="56" class="text-primary" />
    </div>

    <h2 class="text-3xl font-black text-text-1 mb-8 tracking-tighter">숭실 LMS 다운로더</h2>
    <p
      class="text-text-2 text-center max-w-2xl mb-20 text-xl leading-relaxed font-medium opacity-70"
    >
      Canvas LMS에 로그인하여 수강 중인 과목의 강의 비디오를<br />
      데스크톱으로 쉽고 빠르게 다운로드하세요.
    </p>

    <button
      class="group flex items-center gap-3 px-8 py-4 rounded-xl border-none text-base font-bold cursor-pointer bg-primary text-white hover:bg-primary-hover shadow-md hover:shadow-lg transition-all duration-300 hover:-translate-y-1 focus-visible:ring-4 focus-visible:ring-primary/30 focus-visible:outline-none"
      @click="emit('login')"
    >
      <LogIn :size="20" class="group-hover:scale-110 transition-transform" />
      LMS 시스템 로그인
    </button>
  </div>
</template>
