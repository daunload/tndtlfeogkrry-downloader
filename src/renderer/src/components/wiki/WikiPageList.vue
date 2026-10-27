<script setup lang="ts">
import {
  ArrowLeft,
  FileText,
  ExternalLink,
  Download,
  FolderOpen,
  X,
  Loader2,
  CheckCircle2
} from 'lucide-vue-next';
import { computed } from 'vue';
import type { WikiPageItem, WikiPageFileItem } from '../../types';

const props = defineProps<{
  wikiPages: WikiPageItem[];
  isLoading: boolean;
  downloadFolder?: string | null;
  downloadingFileUrls?: Set<string>;
  downloadedFileUrls?: Set<string>;
  summarizedFileUrls?: Set<string>;
  summarizingFileUrls?: Set<string>;
  hasApiKey?: boolean;
  isDownloadingAll?: boolean;
}>();

const emit = defineEmits<{
  back: [];
  selectFolder: [];
  clearFolder: [];
  downloadAll: [];
  downloadFile: [file: WikiPageFileItem];
  summarizeFile: [file: WikiPageFileItem];
}>();

/** 주차별로 묶은 수업자료 (wikiPages는 main에서 주차순 정렬되어 옴) */
const weekGroups = computed(() => {
  const groups = new Map<number, WikiPageItem[]>();
  for (const page of props.wikiPages) {
    const list = groups.get(page.weekPosition) ?? [];
    list.push(page);
    groups.set(page.weekPosition, list);
  }
  return [...groups.entries()].map(([week, pages]) => ({ week, pages }));
});

function isPdf(file: WikiPageFileItem): boolean {
  return file.title.toLowerCase().endsWith('.pdf');
}
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
      <span v-else class="text-sm text-text-3 truncate flex-1">
        폴더를 선택하지 않으면 파일마다 저장 위치를 묻습니다
      </span>
      <button
        v-if="wikiPages.length > 0"
        class="ml-auto flex items-center gap-2 px-4 py-2 rounded-xl border-none text-sm font-bold cursor-pointer whitespace-nowrap bg-primary text-white hover:opacity-90 transition-all shrink-0 disabled:opacity-60"
        :disabled="isDownloadingAll"
        @click="emit('downloadAll')"
      >
        <Loader2 v-if="isDownloadingAll" :size="16" class="animate-spin" />
        <Download v-else :size="16" />
        전체 다운로드
      </button>
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
        이 과목 모듈에 첨부파일이나 위키 페이지가 있는지 확인해주세요.
      </p>
    </div>

    <div v-else class="flex flex-col gap-6 pb-12">
      <div v-for="group in weekGroups" :key="group.week" class="flex flex-col gap-3">
        <h3 class="text-sm font-bold text-text-2 px-1">
          {{ group.week > 0 ? `${group.week}주차` : '기타' }}
        </h3>
        <section
          v-for="page in group.pages"
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
              class="flex items-center gap-3 rounded-xl bg-surface px-3 py-2 border border-border/60"
            >
              <p class="text-sm text-text-1 truncate flex-1 min-w-0">{{ file.title }}</p>
              <div class="ml-auto w-[88px] flex items-center justify-end shrink-0">
                <div
                  v-if="
                    summarizedFileUrls?.has(file.downloadUrl) ||
                    (downloadedFileUrls?.has(file.downloadUrl) && !(hasApiKey && isPdf(file)))
                  "
                  class="flex flex-col items-center justify-center gap-1 w-[88px]"
                >
                  <CheckCircle2 :size="22" class="text-success drop-shadow-sm" />
                  <span class="text-[10px] font-black uppercase tracking-wide text-success"
                    >Done</span
                  >
                </div>

                <button
                  v-else-if="downloadedFileUrls?.has(file.downloadUrl) && hasApiKey && isPdf(file)"
                  class="w-10 h-10 flex items-center justify-center rounded-xl bg-purple-500/10 text-purple-500 hover:bg-purple-500 hover:text-white transition-all duration-300 cursor-pointer shadow-sm hover:shadow-lg disabled:opacity-60"
                  :disabled="summarizingFileUrls?.has(file.downloadUrl)"
                  title="PDF 요약"
                  @click="emit('summarizeFile', file)"
                >
                  <Loader2
                    v-if="summarizingFileUrls?.has(file.downloadUrl)"
                    :size="16"
                    class="animate-spin"
                  />
                  <FileText v-else :size="18" />
                </button>

                <button
                  v-else
                  class="w-10 h-10 flex items-center justify-center rounded-xl bg-surface-mute text-text-2 hover:bg-primary hover:text-white transition-all duration-300 cursor-pointer shadow-sm hover:shadow-lg disabled:opacity-60"
                  :disabled="downloadingFileUrls?.has(file.downloadUrl)"
                  title="다운로드"
                  @click="emit('downloadFile', file)"
                >
                  <Loader2
                    v-if="downloadingFileUrls?.has(file.downloadUrl)"
                    :size="16"
                    class="animate-spin"
                  />
                  <Download v-else :size="18" />
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
