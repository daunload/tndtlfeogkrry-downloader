<script setup lang="ts">
import { ChevronRight, GraduationCap } from 'lucide-vue-next'
import type { CourseItem } from '../../types'

defineProps<{
  course: CourseItem
}>()

const emit = defineEmits<{
  select: [course: CourseItem]
}>()
</script>

<template>
  <div
    class="group flex flex-col justify-between p-5 border border-border/60 rounded-2xl bg-surface cursor-pointer transition-all duration-300 hover:border-primary/50 hover:shadow-md hover:shadow-primary/5 relative overflow-hidden"
    @click="emit('select', course)"
  >
    <div class="absolute -right-4 -top-4 text-surface-mute group-hover:text-primary/5 transition-colors duration-300 z-0">
      <GraduationCap :size="100" />
    </div>
    
    <div class="relative z-10 flex-1 flex flex-col">
      <div class="inline-flex px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-bold w-fit mb-3">
        {{ course.term }}
      </div>
      <div class="text-base font-bold text-text-1 line-clamp-2 leading-snug mb-2 group-hover:text-primary transition-colors">
        {{ course.name }}
      </div>
    </div>
    
    <div class="relative z-10 flex items-center justify-end mt-4">
      <div class="flex items-center text-xs font-medium text-text-3 group-hover:text-primary transition-colors">
        영상 보기
        <ChevronRight :size="16" class="ml-1 transform group-hover:translate-x-1 transition-transform" />
      </div>
    </div>
  </div>
</template>
