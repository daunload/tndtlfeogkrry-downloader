import { ref, computed, type Ref, type ComputedRef } from 'vue';
import type { DownloadRecordWithStatus } from '../types';

const records = ref<DownloadRecordWithStatus[]>([]);
const isLoading = ref(false);

interface UseLibraryReturn {
  records: Ref<DownloadRecordWithStatus[]>;
  isLoading: Ref<boolean>;
  groupedByCourse: ComputedRef<Map<string, DownloadRecordWithStatus[]>>;
  loadHistory: () => Promise<void>;
  removeFromHistory: (contentId: string) => Promise<void>;
  openFile: (filePath: string) => Promise<void>;
  showInFolder: (filePath: string) => Promise<void>;
  formatDate: (isoDate: string) => string;
  formatSize: (bytes: number) => string;
  formatDuration: (seconds: number) => string;
}

export function useLibrary(): UseLibraryReturn {
  const groupedByCourse = computed(() => {
    const map = new Map<string, DownloadRecordWithStatus[]>();
    for (const r of records.value) {
      if (!map.has(r.courseName)) map.set(r.courseName, []);
      map.get(r.courseName)!.push(r);
    }
    return map;
  });

  async function loadHistory(): Promise<void> {
    isLoading.value = true;
    const result = await window.api.getHistory();
    if (result.success && result.records) {
      records.value = result.records;
    }
    isLoading.value = false;
  }

  async function removeFromHistory(contentId: string): Promise<void> {
    await window.api.removeHistory(contentId);
    records.value = records.value.filter((r) => r.contentId !== contentId);
  }

  async function openFile(filePath: string): Promise<void> {
    await window.api.openFile(filePath);
  }

  async function showInFolder(filePath: string): Promise<void> {
    await window.api.showInFolder(filePath);
  }

  function formatDate(isoDate: string): string {
    const d = new Date(isoDate);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${y}.${m}.${day} ${h}:${min}`;
  }

  function formatSize(bytes: number): string {
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}분 ${s}초`;
  }

  return {
    records,
    isLoading,
    groupedByCourse,
    loadHistory,
    removeFromHistory,
    openFile,
    showInFolder,
    formatDate,
    formatSize,
    formatDuration
  };
}
