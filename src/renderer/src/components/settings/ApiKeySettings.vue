<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Key, Check, Trash2, X, Eye, EyeOff, Sparkles, ChevronDown, Cpu } from 'lucide-vue-next';
import { DEFAULT_GEMINI_MODEL, TRANSCRIBE_ENGINE_OPTIONS } from '../../../../shared/config';
import type { GeminiModelId, GeminiModelOption, TranscribeEngine } from '../../../../shared/types';

const props = defineProps<{
  hasApiKey: boolean;
  selectedModel: GeminiModelId;
  selectedEngine: TranscribeEngine;
  modelOptions: GeminiModelOption[];
  keyError?: string;
  isVerifyingKey?: boolean;
}>();

const emit = defineEmits<{
  save: [key: string];
  saveModel: [model: GeminiModelId];
  saveEngine: [engine: TranscribeEngine];
  delete: [];
  close: [];
}>();

const keyInput = ref('');
const localModel = ref<GeminiModelId>(props.selectedModel);
const showKey = ref(false);
const isSavingModel = ref(false);
const isModelDropdownOpen = ref(false);

const selectedOption = computed(
  () => props.modelOptions.find((option) => option.id === localModel.value) ?? props.modelOptions[0]
);

watch(
  () => props.selectedModel,
  (model) => {
    localModel.value = model;
  }
);

function handleSave(): void {
  if (!keyInput.value.trim() || props.isVerifyingKey) return;
  emit('save', keyInput.value.trim());
}

// 검증 성공 시에만 입력값을 비운다 (실패하면 수정할 수 있도록 유지)
watch(
  () => props.hasApiKey,
  (has) => {
    if (has) keyInput.value = '';
  }
);

async function handleSaveModel(): Promise<void> {
  if (localModel.value === props.selectedModel) return;
  isSavingModel.value = true;
  emit('saveModel', localModel.value);
  isModelDropdownOpen.value = false;
  isSavingModel.value = false;
}

function toggleModelDropdown(): void {
  isModelDropdownOpen.value = !isModelDropdownOpen.value;
}

function selectModel(model: GeminiModelId): void {
  localModel.value = model;
  isModelDropdownOpen.value = false;
}
</script>

<template>
  <div
    class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
    @click.self="emit('close')"
  >
    <div
      class="bg-surface rounded-3xl shadow-2xl w-full max-w-md max-h-[calc(100vh-2rem)] overflow-hidden border border-border/50"
      @click="isModelDropdownOpen = false"
    >
      <div class="flex items-center justify-between px-7 py-5 border-b border-border/50">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-purple-500/10 flex items-center justify-center">
            <Key :size="18" class="text-purple-500" />
          </div>
          <h3 class="text-lg font-bold text-text-1">설정</h3>
        </div>
        <button
          class="p-2 rounded-xl text-text-3 hover:bg-surface-mute hover:text-text-1 transition-all"
          @click="emit('close')"
        >
          <X :size="18" />
        </button>
      </div>

      <div class="max-h-[calc(100vh-8rem)] overflow-y-auto p-7">
        <div class="space-y-7">
          <section class="space-y-4">
            <div class="flex items-center gap-2">
              <Cpu :size="16" class="text-primary" />
              <h4 class="text-sm font-bold text-text-1">텍스트 변환 엔진</h4>
            </div>

            <div class="space-y-2">
              <button
                v-for="option in TRANSCRIBE_ENGINE_OPTIONS"
                :key="option.id"
                class="flex w-full items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition-all"
                :class="
                  option.id === selectedEngine
                    ? 'border-primary/40 bg-primary/8'
                    : 'border-border/50 bg-surface-mute hover:border-primary/30 hover:bg-surface-soft'
                "
                @click="option.id !== selectedEngine && emit('saveEngine', option.id)"
              >
                <div class="min-w-0">
                  <span class="text-sm font-semibold text-text-1">{{ option.label }}</span>
                  <p class="mt-1 text-xs leading-5 text-text-3">{{ option.description }}</p>
                </div>
                <div
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border"
                  :class="
                    option.id === selectedEngine
                      ? 'border-primary bg-primary text-white'
                      : 'border-border'
                  "
                >
                  <Check v-if="option.id === selectedEngine" :size="12" />
                </div>
              </button>
            </div>
          </section>

          <section class="space-y-4">
            <div class="flex items-center gap-2">
              <Sparkles :size="16" class="text-primary" />
              <h4 class="text-sm font-bold text-text-1">사용할 모델</h4>
            </div>

            <div class="space-y-3">
              <div class="relative">
                <button
                  class="w-full rounded-2xl border border-border/50 bg-surface-mute px-4 py-3 text-left transition-all hover:border-primary/30 hover:bg-surface-soft"
                  :class="isModelDropdownOpen ? 'border-primary/40 ring-2 ring-primary/20' : ''"
                  @click.stop="toggleModelDropdown"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div class="min-w-0">
                      <div class="text-sm font-semibold text-text-1">
                        {{ selectedOption.label }}
                      </div>
                      <div class="mt-1 text-xs text-text-3 truncate">모델 선택</div>
                    </div>
                    <ChevronDown
                      :size="16"
                      class="shrink-0 text-text-3 transition-transform"
                      :class="isModelDropdownOpen ? 'rotate-180' : ''"
                    />
                  </div>
                </button>

                <Transition name="fade">
                  <div
                    v-if="isModelDropdownOpen"
                    class="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 overflow-hidden rounded-2xl border border-border/60 bg-surface shadow-2xl shadow-black/10"
                    @click.stop
                  >
                    <button
                      v-for="option in modelOptions"
                      :key="option.id"
                      class="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-all hover:bg-surface-mute"
                      :class="option.id === localModel ? 'bg-primary/8' : ''"
                      @click="selectModel(option.id)"
                    >
                      <div class="min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                          <span class="text-sm font-semibold text-text-1">{{ option.label }}</span>
                          <span
                            v-if="option.id === DEFAULT_GEMINI_MODEL"
                            class="px-2 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-bold"
                          >
                            기본 추천
                          </span>
                        </div>
                        <p class="mt-1 text-xs leading-5 text-text-3">
                          {{ option.description }}
                        </p>
                      </div>
                      <div
                        class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border"
                        :class="
                          option.id === localModel
                            ? 'border-primary bg-primary text-white'
                            : 'border-border'
                        "
                      >
                        <Check v-if="option.id === localModel" :size="12" />
                      </div>
                    </button>
                  </div>
                </Transition>
              </div>

              <div class="rounded-2xl border border-primary/20 bg-primary/8 px-4 py-3">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-sm font-semibold text-text-1">{{ selectedOption.label }}</span>
                  <span
                    v-if="selectedOption.id === DEFAULT_GEMINI_MODEL"
                    class="px-2 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-bold"
                  >
                    기본 추천
                  </span>
                </div>
                <p class="mt-1 text-xs text-text-3 leading-5">
                  {{ selectedOption.description }}
                </p>
              </div>
            </div>

            <button
              class="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold bg-primary text-white hover:bg-primary-hover shadow-lg shadow-primary/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="localModel === selectedModel || isSavingModel"
              @click="handleSaveModel"
            >
              <Sparkles :size="16" />
              모델 저장
            </button>
          </section>

          <section v-if="hasApiKey" class="space-y-4">
            <div
              class="flex items-center gap-3 px-4 py-3 rounded-xl bg-success/10 border border-success/20"
            >
              <Check :size="18" class="text-success" />
              <span class="text-sm font-semibold text-success">API 키가 설정되어 있습니다</span>
            </div>
            <button
              class="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-red-500 hover:bg-red-500/10 border border-red-500/20 transition-all"
              @click="emit('delete')"
            >
              <Trash2 :size="16" />
              API 키 삭제
            </button>
          </section>

          <section v-else class="space-y-4">
            <div class="flex items-center gap-2">
              <Key :size="16" class="text-purple-500" />
              <h4 class="text-sm font-bold text-text-1">Gemini API 키</h4>
            </div>
            <p class="text-sm text-text-3 font-medium">
              텍스트 변환 기능을 사용하려면 Google Gemini API 키가 필요합니다.
            </p>
            <div class="relative">
              <input
                v-model="keyInput"
                :type="showKey ? 'text' : 'password'"
                placeholder="AIza..."
                class="w-full px-4 py-3 pr-12 rounded-xl bg-surface-mute border border-border/50 text-sm text-text-1 placeholder:text-text-3/50 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all"
                @keyup.enter="handleSave"
              />
              <button
                class="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-text-3 hover:text-text-1 transition-colors"
                @click="showKey = !showKey"
              >
                <EyeOff v-if="showKey" :size="16" />
                <Eye v-else :size="16" />
              </button>
            </div>
            <button
              class="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold bg-purple-500 text-white hover:bg-purple-600 shadow-lg shadow-purple-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="!keyInput.trim() || isVerifyingKey"
              @click="handleSave"
            >
              <Key :size="16" />
              {{ isVerifyingKey ? 'API 키 확인 중...' : 'API 키 저장' }}
            </button>
            <p
              v-if="keyError"
              class="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs font-medium text-red-500 leading-5"
            >
              {{ keyError }}
            </p>
            <p class="text-[11px] text-text-3/70 text-center">
              키는 기기에 암호화되어 저장되며 Google API 호출 외에는 외부로 전송되지 않습니다.
            </p>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>
