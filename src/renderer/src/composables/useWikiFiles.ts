import { ref, type Ref } from 'vue';
import { MAX_CONCURRENT_DOWNLOADS } from '../../../shared/config';
import type { WikiPageFileItem } from '../types';

interface UseWikiFilesReturn {
  downloadingWikiFileUrls: Ref<Set<string>>;
  downloadedWikiFileUrls: Ref<Set<string>>;
  summarizedWikiFileUrls: Ref<Set<string>>;
  summarizingWikiFileUrls: Ref<Set<string>>;
  isDownloadingAllWikiFiles: Ref<boolean>;
  loadWikiFileHistory: () => Promise<void>;
  downloadWikiFile: (file: WikiPageFileItem, folderPath?: string) => Promise<void>;
  downloadAllWikiFiles: (files: WikiPageFileItem[], folderPath: string) => Promise<void>;
  summarizeWikiFile: (file: WikiPageFileItem) => Promise<void>;
  wikiMessage: Ref<string>;
}

const downloadingWikiFileUrls = ref<Set<string>>(new Set());
const downloadedWikiFileUrls = ref<Set<string>>(new Set());
const summarizedWikiFileUrls = ref<Set<string>>(new Set());
const summarizingWikiFileUrls = ref<Set<string>>(new Set());
const isDownloadingAllWikiFiles = ref(false);
const wikiDownloadedPaths = ref<Record<string, string>>({});
const wikiMessage = ref('');

function pushWikiMessage(msg: string): void {
  // 같은 문구 연속 발생 시에도 App.vue watch가 다시 반응하도록 리셋 후 재설정
  wikiMessage.value = '';
  setTimeout(() => {
    wikiMessage.value = msg;
  }, 0);
}

export function useWikiFiles(): UseWikiFilesReturn {
  async function loadWikiFileHistory(): Promise<void> {
    const result = await window.api.getWikiFileHistory();
    if (!result.success || !result.records) return;

    downloadedWikiFileUrls.value = new Set(
      result.records.filter((r) => r.fileExists).map((r) => r.downloadUrl)
    );
    summarizedWikiFileUrls.value = new Set(
      result.records.filter((r) => r.summaryExists).map((r) => r.downloadUrl)
    );
    wikiDownloadedPaths.value = Object.fromEntries(
      result.records.filter((r) => r.fileExists).map((r) => [r.downloadUrl, r.filePath])
    );
  }

  async function downloadWikiFile(file: WikiPageFileItem, folderPath?: string): Promise<void> {
    const nextSet = new Set(downloadingWikiFileUrls.value);
    nextSet.add(file.downloadUrl);
    downloadingWikiFileUrls.value = nextSet;

    const result = await window.api.downloadWikiFile(file.downloadUrl, file.title, folderPath);

    const doneSet = new Set(downloadingWikiFileUrls.value);
    doneSet.delete(file.downloadUrl);
    downloadingWikiFileUrls.value = doneSet;

    if (result.success) {
      if (result.filePath) {
        await window.api.addWikiFileHistory({
          downloadUrl: file.downloadUrl,
          title: file.title,
          filePath: result.filePath,
          downloadedAt: new Date().toISOString()
        });
        const downloadedSet = new Set(downloadedWikiFileUrls.value);
        downloadedSet.add(file.downloadUrl);
        downloadedWikiFileUrls.value = downloadedSet;
        wikiDownloadedPaths.value = {
          ...wikiDownloadedPaths.value,
          [file.downloadUrl]: result.filePath
        };
      }
      pushWikiMessage(`수업자료 다운로드 완료: ${file.title}`);
    } else if (result.error !== 'cancelled') {
      pushWikiMessage(`수업자료 다운로드 실패 (${file.title}): ${result.error}`);
    }
  }

  /** 아직 받지 않은 수업자료만 최대 MAX_CONCURRENT_DOWNLOADS개씩 병렬 다운로드 */
  async function downloadAllWikiFiles(
    files: WikiPageFileItem[],
    folderPath: string
  ): Promise<void> {
    const queue = files.filter(
      (f) =>
        !downloadedWikiFileUrls.value.has(f.downloadUrl) &&
        !downloadingWikiFileUrls.value.has(f.downloadUrl)
    );
    if (queue.length === 0) {
      pushWikiMessage('모든 수업자료를 이미 다운로드했습니다.');
      return;
    }

    isDownloadingAllWikiFiles.value = true;
    async function worker(): Promise<void> {
      while (queue.length > 0) {
        const file = queue.shift();
        if (file) await downloadWikiFile(file, folderPath);
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT_DOWNLOADS, queue.length) }, () => worker())
    );

    isDownloadingAllWikiFiles.value = false;
    const succeeded = files.filter((f) => downloadedWikiFileUrls.value.has(f.downloadUrl)).length;
    pushWikiMessage(`수업자료 일괄 다운로드 완료 (${succeeded}/${files.length})`);
  }

  async function summarizeWikiFile(file: WikiPageFileItem): Promise<void> {
    const filePath = wikiDownloadedPaths.value[file.downloadUrl];
    if (!filePath) {
      pushWikiMessage(`먼저 PDF를 다운로드하세요: ${file.title}`);
      return;
    }

    const nextSet = new Set(summarizingWikiFileUrls.value);
    nextSet.add(file.downloadUrl);
    summarizingWikiFileUrls.value = nextSet;

    const result = await window.api.summarizeWikiPdf(filePath);

    const doneSet = new Set(summarizingWikiFileUrls.value);
    doneSet.delete(file.downloadUrl);
    summarizingWikiFileUrls.value = doneSet;

    if (result.success && result.summaryPath) {
      await window.api.updateWikiFileSummary(file.downloadUrl, result.summaryPath);
      const summarizedSet = new Set(summarizedWikiFileUrls.value);
      summarizedSet.add(file.downloadUrl);
      summarizedWikiFileUrls.value = summarizedSet;
      pushWikiMessage(`PDF 요약 완료: ${file.title}`);
    } else {
      pushWikiMessage(`PDF 요약 실패 (${file.title}): ${result.error}`);
    }
  }

  return {
    downloadingWikiFileUrls,
    downloadedWikiFileUrls,
    summarizedWikiFileUrls,
    summarizingWikiFileUrls,
    isDownloadingAllWikiFiles,
    loadWikiFileHistory,
    downloadWikiFile,
    downloadAllWikiFiles,
    summarizeWikiFile,
    wikiMessage
  };
}
