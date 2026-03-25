<script setup lang="ts">
import {
  ArrowLeft,
  FileText,
  ExternalLink,
  Download,
  FolderOpen,
  X,
  Loader2,
  CheckCircle2,
  Sparkles
} from 'lucide-vue-next';
import type { WikiPageItem, WikiPageFileItem } from '../../types';

defineProps<{
  wikiPages: WikiPageItem[];
  isLoading: boolean;
  downloadFolder?: string | null;
  downloadingFileUrls?: Set<string>;
  downloadedFileUrls?: Set<string>;
  summarizedFileUrls?: Set<string>;
  summarizingFileUrls?: Set<string>;
  hasApiKey?: boolean;
}>();

const emit = defineEmits<{
  back: [];
  selectFolder: [];
  clearFolder: [];
  downloadFile: [file: WikiPageFileItem];
  summarizeFile: [file: WikiPageFileItem];
}>();
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex items-center gap-3 mb-8 -ml-2">
      <button
        class="p-2 rounded-2xl border-none cursor-pointer bg-transparent text-text-2 hover:bg-surface-mute hover:text-text-1 transition-all shrink-0"
        title="목록으로 돌아가기"
        @click="emit('back')"
      >
        <ArrowLeft :size="24" />
      </button>
      <h2 class="text-2xl font-black text-text-1 tracking-tight whitespace-nowrap">
        수업자료 리스트
      </h2>
    </div>

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
          title="폴더 선택 해제"
          @click="emit('clearFolder')"
        >
          <X :size="14" />
        </button>
      </div>
      <span v-else class="text-sm text-text-3 truncate">
        폴더를 선택하지 않으면 파일마다 저장 위치를 묻습니다
      </span>
    </div>

    <div
      v-if="!isLoading && wikiPages.length === 0"
      class="flex-1 flex flex-col items-center justify-center text-text-3 py-20"
    >
      <div
        class="w-24 h-24 rounded-3xl bg-surface-mute flex items-center justify-center mb-6 shadow-inner"
      >
        <FileText :size="40" class="text-text-3 opacity-50" />
      </div>
      <p class="text-xl font-bold text-text-2">수업자료가 없습니다.</p>
      <p class="text-sm mt-2 font-medium opacity-70">
        이 과목에 위키 페이지가 있는지 확인해주세요.
      </p>
    </div>

    <div v-else class="flex flex-col gap-4 pb-12">
      <section
        v-for="page in wikiPages"
        :key="`${page.courseId}-${page.url}`"
        class="rounded-2xl border border-border bg-surface-mute p-4"
      >
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="text-base font-semibold text-text-1 truncate">{{ page.title }}</p>
            <p class="text-xs text-text-3 mt-1">첨부파일 {{ page.files.length }}개</p>
          </div>
          <a
            :href="page.url"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 text-xs text-text-3 hover:text-text-1 transition-colors"
            title="원본 수업자료 페이지 열기"
          >
            <ExternalLink :size="14" />
            페이지 열기
          </a>
        </div>

        <div v-if="page.files.length === 0" class="mt-3 text-sm text-text-3">
          첨부파일이 없습니다.
        </div>

        <div v-else class="mt-3 flex flex-col gap-2">
          <div
            v-for="file in page.files"
            :key="file.downloadUrl"
            class="flex items-center justify-between gap-3 rounded-xl bg-surface px-3 py-2 border border-border/60"
          >
            <p class="text-sm text-text-1 truncate">{{ file.title }}</p>
            <button
              v-if="!downloadedFileUrls?.has(file.downloadUrl)"
              class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white hover:bg-primary-hover disabled:opacity-60 shrink-0 whitespace-nowrap"
              :disabled="downloadingFileUrls?.has(file.downloadUrl)"
              @click="emit('downloadFile', file)"
            >
              <Loader2
                v-if="downloadingFileUrls?.has(file.downloadUrl)"
                :size="13"
                class="animate-spin"
              />
              <Download v-else :size="13" />
              다운로드
            </button>
            <button
              v-else-if="hasApiKey && !summarizedFileUrls?.has(file.downloadUrl)"
              class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60 shrink-0 whitespace-nowrap"
              :disabled="summarizingFileUrls?.has(file.downloadUrl)"
              @click="emit('summarizeFile', file)"
            >
              <Loader2
                v-if="summarizingFileUrls?.has(file.downloadUrl)"
                :size="13"
                class="animate-spin"
              />
              <Sparkles v-else :size="13" />
              PDF 요약
            </button>
            <span
              v-if="downloadedFileUrls?.has(file.downloadUrl)"
              class="inline-flex items-center gap-1 text-xs font-semibold text-green-600 shrink-0"
            >
              <CheckCircle2 :size="14" />
              다운로드됨
            </span>
            <span
              v-if="summarizedFileUrls?.has(file.downloadUrl)"
              class="inline-flex items-center gap-1 text-xs font-semibold text-purple-600 shrink-0"
            >
              <Sparkles :size="14" />
              요약완료
            </span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
