<script setup lang="ts">
import { computed, ref } from 'vue';
import { FolderOpen, X, FileText, RefreshCw, Loader2, Search, ArrowUp, ArrowDown } from 'lucide-vue-next';
import type { MarkdownFileItem } from '../../types';

const selectedFolder = ref<string | null>(null);
const markdownFiles = ref<MarkdownFileItem[]>([]);
const selectedFilePath = ref<string | null>(null);
const markdownContent = ref('');
const isLoadingList = ref(false);
const isLoadingContent = ref(false);
const errorMessage = ref('');
const isReaderPage = ref(false);
const searchQuery = ref('');
const sortMode = ref<'recent' | 'name'>('recent');

const selectedFile = computed(() =>
  markdownFiles.value.find((file) => file.filePath === selectedFilePath.value)
);

const visibleFiles = computed(() => {
  const keyword = searchQuery.value.trim().toLowerCase();
  const filtered = keyword
    ? markdownFiles.value.filter(
        (file) =>
          file.name.toLowerCase().includes(keyword) || file.relativePath.toLowerCase().includes(keyword)
      )
    : markdownFiles.value;

  const copied = [...filtered];
  if (sortMode.value === 'name') {
    copied.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  } else {
    copied.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }
  return copied;
});

const selectedFileIndex = computed(() =>
  visibleFiles.value.findIndex((file) => file.filePath === selectedFilePath.value)
);

const renderedMarkdown = computed(() => markdownToHtml(markdownContent.value));

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(markdown: string): string {
  const escaped = escapeHtml(markdown);
  return escaped
    .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-surface-mute text-text-1">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">$1</a>'
    );
}

function markdownToHtml(markdown: string): string {
  if (!markdown.trim()) {
    return '<p class="text-sm text-text-3">파일 내용을 불러오면 여기에 표시됩니다.</p>';
  }

  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const htmlParts: string[] = [];
  let inCodeBlock = false;
  let inList = false;

  const closeList = (): void => {
    if (!inList) return;
    htmlParts.push('</ul>');
    inList = false;
  };

  for (const line of lines) {
    const codeFenceMatch = line.match(/^```/);
    if (codeFenceMatch) {
      closeList();
      if (!inCodeBlock) {
        htmlParts.push(
          '<pre class="overflow-x-auto p-4 rounded-xl bg-surface-mute border border-border/60"><code>'
        );
        inCodeBlock = true;
      } else {
        htmlParts.push('</code></pre>');
        inCodeBlock = false;
      }
      continue;
    }

    if (inCodeBlock) {
      htmlParts.push(`${escapeHtml(line)}\n`);
      continue;
    }

    if (!line.trim()) {
      closeList();
      htmlParts.push('<div class="h-3"></div>');
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      closeList();
      const level = Math.min(6, headingMatch[1].length);
      const text = renderInline(headingMatch[2]);
      htmlParts.push(`<h${level} class="font-bold text-text-1 mt-1 mb-2">${text}</h${level}>`);
      continue;
    }

    const quoteMatch = line.match(/^>\s?(.+)$/);
    if (quoteMatch) {
      closeList();
      htmlParts.push(
        `<blockquote class="border-l-4 border-border pl-3 py-1 text-text-2">${renderInline(
          quoteMatch[1]
        )}</blockquote>`
      );
      continue;
    }

    const listMatch = line.match(/^[-*]\s+(.+)$/);
    if (listMatch) {
      if (!inList) {
        htmlParts.push('<ul class="list-disc pl-6 text-text-1 space-y-1">');
        inList = true;
      }
      htmlParts.push(`<li>${renderInline(listMatch[1])}</li>`);
      continue;
    }

    closeList();
    htmlParts.push(`<p class="text-sm leading-7 text-text-1">${renderInline(line)}</p>`);
  }

  closeList();
  if (inCodeBlock) {
    htmlParts.push('</code></pre>');
  }
  return htmlParts.join('');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR');
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadMarkdownFiles(): Promise<void> {
  if (!selectedFolder.value) return;
  isLoadingList.value = true;
  errorMessage.value = '';

  const result = await window.api.listMarkdownFiles(selectedFolder.value);
  isLoadingList.value = false;

  if (!result.success || !result.files) {
    errorMessage.value = result.error ?? 'Markdown 파일 목록을 불러오지 못했습니다.';
    markdownFiles.value = [];
    selectedFilePath.value = null;
    markdownContent.value = '';
    isReaderPage.value = false;
    return;
  }

  markdownFiles.value = result.files;
  if (result.files.length === 0) {
    selectedFilePath.value = null;
    markdownContent.value = '';
    isReaderPage.value = false;
    return;
  }

  const keepCurrent = result.files.find((file) => file.filePath === selectedFilePath.value);
  if (keepCurrent) return;
  await selectFile(visibleFiles.value[0] ?? result.files[0]);
}

async function selectFolder(): Promise<void> {
  const result = await window.api.selectMarkdownFolder();
  if (!result.success || !result.folderPath) return;
  selectedFolder.value = result.folderPath;
  await loadMarkdownFiles();
}

function clearFolder(): void {
  selectedFolder.value = null;
  markdownFiles.value = [];
  selectedFilePath.value = null;
  markdownContent.value = '';
  errorMessage.value = '';
  isReaderPage.value = false;
}

async function selectFile(file: MarkdownFileItem): Promise<void> {
  selectedFilePath.value = file.filePath;
  isLoadingContent.value = true;
  errorMessage.value = '';

  const result = await window.api.readMarkdownFile(file.filePath);
  isLoadingContent.value = false;

  if (!result.success || result.content === undefined) {
    errorMessage.value = result.error ?? 'Markdown 파일을 읽지 못했습니다.';
    markdownContent.value = '';
    return;
  }

  markdownContent.value = result.content;
}

function openReaderPage(): void {
  if (!selectedFilePath.value) return;
  isReaderPage.value = true;
}

function closeReaderPage(): void {
  isReaderPage.value = false;
}

async function moveFile(direction: 'prev' | 'next'): Promise<void> {
  if (!visibleFiles.value.length) return;
  const currentIndex = selectedFileIndex.value;
  const nextIndex =
    direction === 'prev'
      ? Math.max(0, currentIndex - 1)
      : Math.min(visibleFiles.value.length - 1, currentIndex + 1);
  const target = visibleFiles.value[nextIndex];
  if (!target || target.filePath === selectedFilePath.value) return;
  await selectFile(target);
}
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-6 gap-4">
      <div>
        <h2 class="text-xl sm:text-2xl font-bold text-text-1 tracking-tight">Markdown Viewer</h2>
        <p class="text-sm text-text-3 mt-1 font-medium">
          폴더를 선택하면 해당 폴더 내부의 `.md` 파일만 목록으로 표시됩니다.
        </p>
      </div>
    </div>

    <div class="flex items-center gap-3 mb-3 px-1 min-w-0">
      <button
        class="flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-sm font-medium cursor-pointer whitespace-nowrap bg-surface-mute text-text-2 hover:bg-surface-hover hover:text-text-1 transition-all shrink-0"
        @click="selectFolder"
      >
        <FolderOpen :size="16" />
        폴더 선택
      </button>
      <button
        v-if="selectedFolder"
        class="flex items-center gap-2 px-3 py-2 rounded-xl border border-border text-sm font-medium cursor-pointer whitespace-nowrap bg-surface-mute text-text-2 hover:bg-surface-hover hover:text-text-1 transition-all shrink-0"
        :disabled="isLoadingList"
        @click="loadMarkdownFiles"
      >
        <RefreshCw :size="16" :class="{ 'animate-spin': isLoadingList }" />
        새로고침
      </button>
      <div v-if="selectedFolder" class="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
        <span class="text-sm text-text-2 truncate" :title="selectedFolder">
          {{ selectedFolder }}
        </span>
        <button
          class="p-1 rounded-lg border-none cursor-pointer bg-transparent text-text-3 hover:bg-surface-mute hover:text-text-1 transition-all shrink-0"
          title="폴더 선택 해제"
          @click="clearFolder"
        >
          <X :size="14" />
        </button>
      </div>
      <span v-else class="text-sm text-text-3 truncate">폴더 선택 후에만 목록을 불러옵니다.</span>
    </div>

    <div v-if="selectedFolder" class="mb-5 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-3">
      <label class="relative">
        <Search :size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="파일명 또는 경로로 검색"
          class="w-full h-10 pl-9 pr-3 rounded-xl border border-border bg-surface text-sm text-text-1 placeholder:text-text-3 focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </label>
      <div class="inline-flex rounded-xl border border-border bg-surface p-1 shrink-0">
        <button
          class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
          :class="
            sortMode === 'recent' ? 'bg-primary/10 text-primary' : 'text-text-2 hover:bg-surface-mute'
          "
          @click="sortMode = 'recent'"
        >
          최신순
        </button>
        <button
          class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
          :class="sortMode === 'name' ? 'bg-primary/10 text-primary' : 'text-text-2 hover:bg-surface-mute'"
          @click="sortMode = 'name'"
        >
          이름순
        </button>
      </div>
    </div>

    <p v-if="errorMessage" class="mb-4 text-sm font-semibold text-red-500">
      {{ errorMessage }}
    </p>

    <div
      v-if="!selectedFolder"
      class="flex-1 flex flex-col items-center justify-center text-text-3 py-16 rounded-2xl border border-dashed border-border"
    >
      <FolderOpen :size="42" class="opacity-40 mb-4" />
      <p class="text-lg font-bold text-text-2">먼저 폴더를 선택해주세요.</p>
      <p class="text-sm mt-1.5 font-medium opacity-70">
        선택한 폴더에서 `.md` 파일만 자동으로 수집됩니다.
      </p>
    </div>

    <div
      v-else-if="isReaderPage"
      class="flex-1 min-h-0 rounded-2xl border border-border bg-surface p-5 overflow-hidden flex flex-col"
    >
      <div class="mb-4 pb-3 border-b border-border/60 flex items-center justify-between gap-3">
        <h3 class="text-base font-bold text-text-1 truncate">
          {{ selectedFile?.relativePath ?? '파일을 선택하세요' }}
        </h3>
        <div class="flex items-center gap-2 shrink-0">
          <button
            class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-2 hover:bg-surface-mute hover:text-text-1 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="selectedFileIndex <= 0"
            @click="moveFile('prev')"
          >
            <ArrowUp :size="14" />
            이전
          </button>
          <button
            class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-2 hover:bg-surface-mute hover:text-text-1 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="selectedFileIndex < 0 || selectedFileIndex >= visibleFiles.length - 1"
            @click="moveFile('next')"
          >
            <ArrowDown :size="14" />
            다음
          </button>
          <button
            class="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-2 hover:bg-surface-mute hover:text-text-1 transition-all"
            @click="closeReaderPage"
          >
            분할 뷰로 돌아가기
          </button>
        </div>
      </div>

      <div v-if="isLoadingContent" class="flex items-center gap-2 text-sm text-text-3">
        <Loader2 :size="16" class="animate-spin" />
        파일 불러오는 중...
      </div>

      <div v-else class="pretty-scroll flex-1 overflow-auto pr-1">
        <article class="markdown-content reader-content mx-auto" v-html="renderedMarkdown"></article>
      </div>
    </div>

    <div v-else class="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-4">
      <section class="min-h-0 rounded-2xl border border-border bg-surface p-3 overflow-hidden flex flex-col">
        <div class="flex items-center justify-between mb-3 px-1">
          <h3 class="text-sm font-bold text-text-1">파일 목록</h3>
          <span class="text-xs font-semibold text-text-3"
            >{{ visibleFiles.length }} / {{ markdownFiles.length }}개</span
          >
        </div>

        <div
          v-if="isLoadingList"
          class="flex-1 flex items-center justify-center text-sm text-text-3 gap-2"
        >
          <Loader2 :size="16" class="animate-spin" />
          목록 불러오는 중...
        </div>

        <div
          v-else-if="visibleFiles.length === 0"
          class="flex-1 flex flex-col items-center justify-center text-text-3 gap-2"
        >
          <FileText :size="24" class="opacity-40" />
          <p class="text-sm font-semibold">
            {{ markdownFiles.length === 0 ? '이 폴더에는 `.md` 파일이 없습니다.' : '검색 결과가 없습니다.' }}
          </p>
        </div>

        <div v-else class="pretty-scroll flex-1 overflow-auto pr-1 space-y-2">
          <button
            v-for="file in visibleFiles"
            :key="file.filePath"
            class="w-full text-left p-3 rounded-xl border transition-all"
            :class="
              selectedFilePath === file.filePath
                ? 'border-primary bg-primary/10'
                : 'border-border/60 bg-surface-mute hover:border-primary/30'
            "
            @click="selectFile(file)"
            @dblclick="openReaderPage"
          >
            <p class="text-sm font-semibold text-text-1 truncate">{{ file.name }}</p>
            <p class="text-xs text-text-3 truncate mt-1">{{ file.relativePath }}</p>
            <div class="mt-2 flex items-center gap-2 text-[11px] text-text-3 font-medium">
              <span>{{ formatSize(file.size) }}</span>
              <span>·</span>
              <span>{{ formatDate(file.updatedAt) }}</span>
            </div>
          </button>
        </div>
      </section>

      <section class="pretty-scroll min-h-0 rounded-2xl border border-border bg-surface p-5 overflow-auto">
        <div class="mb-4 pb-3 border-b border-border/60 flex items-center justify-between gap-3">
          <h3 class="text-base font-bold text-text-1 truncate">
            {{ selectedFile?.relativePath ?? '파일을 선택하세요' }}
          </h3>
          <div class="flex items-center gap-2 shrink-0">
            <button
              class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-2 hover:bg-surface-mute hover:text-text-1 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              :disabled="selectedFileIndex <= 0"
              @click="moveFile('prev')"
            >
              <ArrowUp :size="14" />
              이전
            </button>
            <button
              class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-2 hover:bg-surface-mute hover:text-text-1 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              :disabled="selectedFileIndex < 0 || selectedFileIndex >= visibleFiles.length - 1"
              @click="moveFile('next')"
            >
              <ArrowDown :size="14" />
              다음
            </button>
            <button
              class="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-2 hover:bg-surface-mute hover:text-text-1 transition-all shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="!selectedFilePath"
              @click="openReaderPage"
            >
              페이지로 보기
            </button>
          </div>
        </div>

        <div v-if="isLoadingContent" class="flex items-center gap-2 text-sm text-text-3">
          <Loader2 :size="16" class="animate-spin" />
          파일 불러오는 중...
        </div>

        <article
          v-else-if="selectedFilePath"
          class="markdown-content"
          v-html="renderedMarkdown"
        ></article>

        <div v-else class="h-full flex flex-col items-center justify-center text-text-3 gap-2 py-12">
          <FileText :size="28" class="opacity-40" />
          <p class="text-sm font-semibold">왼쪽 목록에서 파일을 선택하세요.</p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.pretty-scroll {
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--color-primary) 46%, transparent) transparent;
}

.pretty-scroll::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

.pretty-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.pretty-scroll::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-primary) 34%, var(--color-border) 66%);
  border: 2px solid transparent;
  background-clip: content-box;
}

.pretty-scroll::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--color-primary) 62%, var(--color-border) 38%);
  background-clip: content-box;
}

.pretty-scroll::-webkit-scrollbar-corner {
  background: transparent;
}

.markdown-content :deep(h1) {
  font-size: 1.75rem;
  line-height: 2.2rem;
}

.markdown-content :deep(h2) {
  font-size: 1.45rem;
  line-height: 2rem;
}

.markdown-content :deep(h3) {
  font-size: 1.2rem;
  line-height: 1.8rem;
}

.reader-content {
  max-width: 940px;
}
</style>
