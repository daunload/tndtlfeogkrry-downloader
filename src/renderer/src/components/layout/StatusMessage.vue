<script setup lang="ts">
import { Info } from 'lucide-vue-next'

defineProps<{
  message: string
}>()
</script>

<template>
  <Transition name="toast">
    <div
      v-if="message"
      class="flex items-center gap-3 px-5 py-3.5 bg-text-1 text-surface rounded-2xl shadow-xl transition-all duration-300 max-w-md"
    >
      <Info :size="18" class="text-primary shrink-0" />
      <span class="text-[14px] font-medium leading-tight">{{ message }}</span>
    </div>
  </Transition>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(20px) scale(0.9);
}
</style>
