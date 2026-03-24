<script setup lang="ts">
import { ChevronRight } from 'lucide-vue-next';
import type { CourseItem } from '../../types';

defineProps<{
  course: CourseItem;
}>();

const emit = defineEmits<{
  select: [course: CourseItem];
}>();
</script>

<template>
  <div
    class="group flex items-center gap-3 px-4 py-3 border border-border/60 rounded-xl bg-surface cursor-pointer transition-all hover:border-primary/50 hover:bg-primary/5"
    @click="emit('select', course)"
  >
    <span
      class="shrink-0 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[11px] font-bold"
    >
      {{ course.term }}
    </span>
    <span
      class="flex-1 text-sm font-semibold text-text-1 truncate group-hover:text-primary transition-colors"
    >
      {{ course.name }}
    </span>
    <ChevronRight
      :size="16"
      class="shrink-0 text-text-3 group-hover:text-primary group-hover:translate-x-0.5 transition-all"
    />
  </div>
</template>
