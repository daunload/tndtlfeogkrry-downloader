import { ref, onUnmounted, type Ref } from 'vue';

export interface TranscribeStatus {
  status: 'transcribing' | 'merging' | 'done' | 'error';
  currentPart?: number;
  totalParts?: number;
  currentFile?: number;
  totalFiles?: number;
}

const hasApiKey = ref(false);
const withSummary = ref(true);
const isTranscribing = ref(false);
const isTranscribingBatch = ref(false);
const transcribeProgressMap = ref<Record<string, number>>({});
const transcribeStatusMap = ref<Record<string, TranscribeStatus>>({});
const transcribeMessage = ref('');

interface UseTranscriberReturn {
  hasApiKey: Ref<boolean>;
  withSummary: Ref<boolean>;
  isTranscribing: Ref<boolean>;
  isTranscribingBatch: Ref<boolean>;
  transcribeProgressMap: Ref<Record<string, number>>;
  transcribeStatusMap: Ref<Record<string, TranscribeStatus>>;
  transcribeMessage: Ref<string>;
  checkApiKey: () => Promise<void>;
  saveApiKey: (key: string) => Promise<boolean>;
  deleteApiKey: () => Promise<void>;
  transcribe: (filePath: string, fileName: string) => Promise<void>;
  transcribeBatch: (dirPath: string) => Promise<void>;
  downloadAndTranscribeAll: (
    videos: { contentId: string; title: string }[],
    folderPath?: string
  ) => Promise<void>;
  openFile: (filePath: string) => Promise<void>;
}

export function useTranscriber(): UseTranscriberReturn {
  window.api.onTranscribeProgress((data) => {
    transcribeProgressMap.value[data.fileName] = data.percent;
    transcribeStatusMap.value[data.fileName] = {
      status: data.status,
      currentPart: data.currentPart,
      totalParts: data.totalParts,
      currentFile: data.currentFile,
      totalFiles: data.totalFiles
    };
  });

  onUnmounted(() => {
    window.api.removeTranscribeProgress();
  });

  async function checkApiKey(): Promise<void> {
    const result = await window.api.getGeminiApiKey();
    hasApiKey.value = result.hasKey;
  }

  async function saveApiKey(key: string): Promise<boolean> {
    const result = await window.api.setGeminiApiKey(key);
    if (result.success) {
      hasApiKey.value = true;
      return true;
    }
    return false;
  }

  async function deleteApiKey(): Promise<void> {
    await window.api.deleteGeminiApiKey();
    hasApiKey.value = false;
  }

  async function transcribe(filePath: string, fileName: string): Promise<void> {
    isTranscribing.value = true;
    transcribeProgressMap.value[fileName] = 0;
    transcribeMessage.value = `텍스트 변환 중: ${fileName}`;

    const result = await window.api.transcribeAudio(filePath, withSummary.value);

    isTranscribing.value = false;

    if (result.success) {
      transcribeProgressMap.value[fileName] = 100;
      transcribeMessage.value = `변환 완료: ${fileName}`;
    } else {
      delete transcribeProgressMap.value[fileName];
      transcribeMessage.value = `변환 실패 (${fileName}): ${result.error}`;
    }
  }

  async function transcribeBatch(dirPath: string): Promise<void> {
    isTranscribingBatch.value = true;
    transcribeMessage.value = '전체 텍스트 변환을 시작합니다...';

    const result = await window.api.transcribeBatch(dirPath, withSummary.value);

    isTranscribingBatch.value = false;

    if (result.success && result.results) {
      transcribeMessage.value = `전체 변환 완료: ${result.successCount}/${result.total}개 성공`;
    } else {
      transcribeMessage.value = result.error || '전체 변환 실패';
    }
  }

  async function downloadAndTranscribeAll(
    videos: { contentId: string; title: string }[],
    folderPath?: string
  ): Promise<void> {
    isTranscribingBatch.value = true;
    transcribeMessage.value = '전체 다운로드 및 텍스트 변환을 시작합니다...';

    const result = await window.api.downloadAndTranscribeAll(videos, folderPath, withSummary.value);

    isTranscribingBatch.value = false;

    if (result.error === 'cancelled') {
      transcribeMessage.value = '';
      return;
    }

    if (result.success) {
      transcribeMessage.value = `다운로드 ${result.downloadSuccessCount}/${result.total}개, 변환 ${result.transcribeSuccessCount}/${result.total}개 성공`;
    } else {
      transcribeMessage.value = result.error || '전체 변환 실패';
    }
  }

  async function openFile(filePath: string): Promise<void> {
    await window.api.openFile(filePath);
  }

  return {
    hasApiKey,
    withSummary,
    isTranscribing,
    isTranscribingBatch,
    transcribeProgressMap,
    transcribeStatusMap,
    transcribeMessage,
    checkApiKey,
    saveApiKey,
    deleteApiKey,
    transcribe,
    transcribeBatch,
    downloadAndTranscribeAll,
    openFile
  };
}
