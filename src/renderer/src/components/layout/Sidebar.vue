<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  Sun,
  Moon,
  Book,
  LogIn,
  ArrowUpCircle,
  Settings,
  Archive,
  FileText
} from 'lucide-vue-next';
import { useTheme } from '../../composables/useTheme';

defineProps<{
  isLoggedIn: boolean;
  hasApiKey: boolean;
  activeView: 'courses' | 'library' | 'markdown';
}>();

const emit = defineEmits<{
  login: [];
  openSettings: [];
  openLibrary: [];
  openMarkdown: [];
  openCourses: [];
}>();

const { isDark, toggleTheme } = useTheme();

const updateInfo = ref<{
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion?: string;
  downloadUrl?: string;
} | null>(null);

onMounted(async () => {
  try {
    const result = await window.api.checkForUpdate();
    updateInfo.value = result;
  } catch {
    // 업데이트 확인 실패 무시
  }
});

function openDownload(): void {
  if (updateInfo.value?.downloadUrl) {
    window.open(updateInfo.value.downloadUrl);
  }
}
</script>

<template>
  <aside
    class="w-20 md:w-64 border-r border-border/50 bg-surface-soft flex flex-col transition-all duration-300 h-full overflow-hidden group shrink-0"
  >
    <div class="p-5 md:p-8 flex items-center gap-4">
      <div
        class="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-white font-bold shadow-sm shrink-0"
      >
        S
      </div>
      <h1
        class="text-xl font-extrabold text-text-1 tracking-tight hidden md:block whitespace-nowrap"
      >
        숭실 다운로더
      </h1>
    </div>

    <nav class="flex-1 px-3 md:px-5 py-4 flex flex-col gap-2">
      <div
        class="px-3 py-2 text-[10px] md:text-[11px] font-bold text-text-3 uppercase tracking-[0.1em] mb-2 opacity-70 hidden md:block"
      >
        Main Menu
      </div>

      <button
        class="w-full flex items-center justify-center md:justify-start gap-0 md:gap-3.5 px-0 md:px-4 py-3 rounded-xl text-sm font-semibold transition-all group/btn"
        :class="
          activeView === 'courses'
            ? 'bg-primary/10 text-primary shadow-sm shadow-primary/5 font-semibold'
            : 'text-text-2 hover:bg-surface-mute hover:text-text-1 font-medium'
        "
        title="내 강의 목록"
        @click="emit('openCourses')"
      >
        <Book :size="20" class="shrink-0" />
        <span class="hidden md:block">내 강의 목록</span>
      </button>

      <button
        class="w-full flex items-center justify-center md:justify-start gap-0 md:gap-3.5 px-0 md:px-4 py-3 rounded-xl text-sm transition-all group/btn"
        :class="
          activeView === 'library'
            ? 'bg-primary/10 text-primary shadow-sm shadow-primary/5 font-semibold'
            : 'text-text-2 hover:bg-surface-mute hover:text-text-1 font-medium'
        "
        title="내 라이브러리"
        @click="emit('openLibrary')"
      >
        <Archive :size="20" class="shrink-0" />
        <span class="hidden md:block">내 라이브러리</span>
      </button>

      <button
        class="w-full flex items-center justify-center md:justify-start gap-0 md:gap-3.5 px-0 md:px-4 py-3 rounded-xl text-sm transition-all group/btn"
        :class="
          activeView === 'markdown'
            ? 'bg-primary/10 text-primary shadow-sm shadow-primary/5 font-semibold'
            : 'text-text-2 hover:bg-surface-mute hover:text-text-1 font-medium'
        "
        title="Markdown Viewer"
        @click="emit('openMarkdown')"
      >
        <FileText :size="20" class="shrink-0" />
        <span class="hidden md:block">마크다운 뷰어</span>
      </button>

      <button
        class="w-full flex items-center justify-center md:justify-start gap-0 md:gap-3.5 px-0 md:px-4 py-3 rounded-xl text-sm font-medium text-text-2 hover:bg-surface-mute hover:text-text-1 transition-all group/btn"
        title="설정"
        @click="emit('openSettings')"
      >
        <Settings :size="20" :class="hasApiKey ? 'text-purple-500' : ''" class="shrink-0" />
        <span class="hidden md:block flex-1 text-left whitespace-nowrap">설정</span>
        <span v-if="hasApiKey" class="hidden md:block w-2 h-2 rounded-full bg-success"></span>
      </button>
    </nav>

    <div class="p-4 md:p-6 border-t border-border/50 flex flex-col gap-3">
      <!-- 업데이트 알림 -->
      <button
        v-if="updateInfo?.hasUpdate"
        class="w-full flex items-center justify-center md:justify-start gap-0 md:gap-2.5 px-0 md:px-4 py-2.5 rounded-xl text-sm font-bold bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 transition-all cursor-pointer border border-amber-500/30"
        :title="`v${updateInfo.latestVersion} 업데이트 다운로드`"
        @click="openDownload"
      >
        <ArrowUpCircle :size="18" class="shrink-0 animate-bounce" />
        <span class="hidden md:block whitespace-nowrap truncate"
          >v{{ updateInfo.latestVersion }} 업데이트</span
        >
      </button>

      <button
        v-if="!isLoggedIn"
        class="w-full h-12 md:h-auto flex items-center justify-center gap-0 md:gap-2 px-0 md:px-4 py-2.5 rounded-xl text-sm font-bold bg-primary text-white hover:bg-primary-hover shadow-md transition-all hover:scale-[1.02] active:scale-[0.98]"
        title="LMS 로그인"
        @click="emit('login')"
      >
        <LogIn :size="18" class="shrink-0" />
        <span class="hidden md:block whitespace-nowrap">LMS 로그인</span>
      </button>
      <div
        v-else
        class="h-12 md:h-auto flex items-center justify-center md:px-4 md:py-2.5 rounded-xl text-xs md:text-sm font-bold bg-success/10 text-success text-center border border-success/20"
        title="로그인 됨"
      >
        <div class="md:hidden w-2 h-2 rounded-full bg-success"></div>
        <span class="hidden md:block whitespace-nowrap">로그인 됨</span>
      </div>

      <button
        class="w-full h-12 md:h-auto flex items-center justify-center md:justify-between px-0 md:px-4 py-2.5 rounded-xl text-sm font-semibold text-text-2 hover:bg-surface-mute hover:text-text-1 transition-all"
        :title="isDark ? '라이트 모드' : '다크 모드'"
        @click="toggleTheme"
      >
        <span class="flex items-center gap-3.5">
          <Moon v-if="isDark" :size="18" class="shrink-0" />
          <Sun v-else :size="18" class="shrink-0" />
          <span class="hidden md:block whitespace-nowrap">{{
            isDark ? '라이트 모드' : '다크 모드'
          }}</span>
        </span>
      </button>

      <!-- 현재 버전 -->
      <div v-if="updateInfo" class="hidden md:block text-center text-[10px] text-text-3 opacity-50">
        v{{ updateInfo.currentVersion }}
      </div>
    </div>
  </aside>
</template>
