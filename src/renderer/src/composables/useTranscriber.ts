import { ref, onUnmounted, type Ref } from 'vue';
import { DEFAULT_GEMINI_MODEL } from '../../../shared/config';
import type { GeminiModelId } from '../../../shared/types';

export interface TranscribeStatus {
  status: 'converting' | 'uploading' | 'transcribing' | 'merging' | 'done' | 'error';
  currentPart?: number;
  totalParts?: number;
  currentFile?: number;
  totalFiles?: number;
}

const hasApiKey = ref(false);
const selectedGeminiModel = ref<GeminiModelId>(DEFAULT_GEMINI_MODEL);
const withSummary = ref(true);
const useFileApi = ref(false);
const isTranscribing = ref(false);
const isTranscribingBatch = ref(false);
const transcribeProgressMap = ref<Record<string, number>>({});
const transcribeStatusMap = ref<Record<string, TranscribeStatus>>({});
const transcribeMessage = ref('');

interface UseTranscriberReturn {
  hasApiKey: Ref<boolean>;
  selectedGeminiModel: Ref<GeminiModelId>;
  withSummary: Ref<boolean>;
  useFileApi: Ref<boolean>;
  isTranscribing: Ref<boolean>;
  isTranscribingBatch: Ref<boolean>;
  transcribeProgressMap: Ref<Record<string, number>>;
  transcribeStatusMap: Ref<Record<string, TranscribeStatus>>;
  transcribeMessage: Ref<string>;
  checkApiKey: () => Promise<void>;
  saveApiKey: (key: string) => Promise<boolean>;
  deleteApiKey: () => Promise<void>;
  loadGeminiModel: () => Promise<void>;
  saveGeminiModel: (model: GeminiModelId) => Promise<boolean>;
  transcribe: (
    filePath: string,
    fileName: string
  ) => Promise<{ success: boolean; txtPath?: string } | undefined>;
  transcribeBatch: (dirPath: string) => Promise<void>;
  downloadAndTranscribeAll: (
    videos: { contentId: string; title: string; fileSize: number; duration: number }[],
    folderPath?: string,
    meta?: { courseId: string; courseName: string }
  ) => Promise<void>;
  openFile: (filePath: string) => Promise<void>;
}

function statusToMessage(data: {
  fileName: string;
  status: string;
  currentPart?: number;
  totalParts?: number;
  currentFile?: number;
  totalFiles?: number;
}): string {
  const name = data.fileName.replace(/\.[^.]+$/, '');
  const fileInfo =
    data.totalFiles && data.totalFiles > 1 ? ` [${data.currentFile}/${data.totalFiles}]` : '';
  const partInfo =
    data.totalParts && data.totalParts > 1 ? ` (파트 ${data.currentPart}/${data.totalParts})` : '';

  switch (data.status) {
    case 'converting':
      return `MP3 변환 중${fileInfo}: ${name}`;
    case 'uploading':
      return `파일 업로드 중${fileInfo}${partInfo}: ${name}`;
    case 'transcribing':
      return `텍스트 변환 중${fileInfo}${partInfo}: ${name}`;
    case 'merging':
      return `파트 병합 중${fileInfo}: ${name}`;
    case 'done':
      return `변환 완료${fileInfo}: ${name}`;
    case 'error':
      return `변환 실패${fileInfo}: ${name}`;
    default:
      return `처리 중: ${name}`;
  }
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
    if (data.batchCompleted != null && data.batchTotal != null) {
      transcribeMessage.value = `텍스트 변환 중: ${data.batchCompleted}/${data.batchTotal}개 완료`;
    } else {
      transcribeMessage.value = statusToMessage(data);
    }
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

  async function loadGeminiModel(): Promise<void> {
    const result = await window.api.getGeminiModel();
    selectedGeminiModel.value = result.model;
  }

  async function saveGeminiModel(model: GeminiModelId): Promise<boolean> {
    const result = await window.api.setGeminiModel(model);
    if (result.success) {
      selectedGeminiModel.value = model;
      transcribeMessage.value = `Gemini 모델 변경: ${model}`;
      return true;
    }

    transcribeMessage.value = result.error || 'Gemini 모델 저장 실패';
    return false;
  }

  async function transcribe(
    filePath: string,
    fileName: string
  ): Promise<{ success: boolean; txtPath?: string } | undefined> {
    isTranscribing.value = true;
    transcribeProgressMap.value[fileName] = 0;
    transcribeMessage.value = `텍스트 변환 중: ${fileName}`;

    const result = await window.api.transcribeAudio(filePath, withSummary.value, useFileApi.value);

    isTranscribing.value = false;

    if (result.success) {
      transcribeProgressMap.value[fileName] = 100;
      transcribeMessage.value = `변환 완료: ${fileName}`;
      return { success: true, txtPath: result.txtPath };
    } else {
      delete transcribeProgressMap.value[fileName];
      transcribeMessage.value = `변환 실패 (${fileName}): ${result.error}`;
      return { success: false };
    }
  }

  async function transcribeBatch(dirPath: string): Promise<void> {
    isTranscribingBatch.value = true;
    transcribeMessage.value = '전체 텍스트 변환을 시작합니다...';

    const result = await window.api.transcribeBatch(dirPath, withSummary.value, useFileApi.value);

    isTranscribingBatch.value = false;

    if (result.success && result.results) {
      transcribeMessage.value = `전체 변환 완료: ${result.successCount}/${result.total}개 성공`;
    } else {
      transcribeMessage.value = result.error || '전체 변환 실패';
    }
  }

  async function downloadAndTranscribeAll(
    videos: { contentId: string; title: string; fileSize: number; duration: number }[],
    folderPath?: string,
    meta?: { courseId: string; courseName: string }
  ): Promise<void> {
    isTranscribingBatch.value = true;
    transcribeMessage.value = '전체 다운로드 및 텍스트 변환을 시작합니다...';

    const result = await window.api.downloadAndTranscribeAll(
      videos,
      folderPath,
      withSummary.value,
      useFileApi.value,
      meta
    );

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
    selectedGeminiModel,
    withSummary,
    useFileApi,
    isTranscribing,
    isTranscribingBatch,
    transcribeProgressMap,
    transcribeStatusMap,
    transcribeMessage,
    checkApiKey,
    saveApiKey,
    deleteApiKey,
    loadGeminiModel,
    saveGeminiModel,
    transcribe,
    transcribeBatch,
    downloadAndTranscribeAll,
    openFile
  };
}
