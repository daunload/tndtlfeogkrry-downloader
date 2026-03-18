<script setup lang="ts">
defineProps<{
  percent: number
}>()
</script>

<template>
  <div class="h-1 w-full rounded-full bg-surface-mute overflow-hidden mt-1.5">
    <div
      class="h-full bg-primary rounded-full transition-all duration-200"
      :style="{ width: percent + '%' }"
    />
  </div>
</template>
