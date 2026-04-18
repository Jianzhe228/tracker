<script setup lang="ts">
defineProps<{
  title: string;
  description?: string;
  icon?: string;
}>();
</script>

<template>
  <div class="flex flex-col items-center justify-center py-10 text-center">
    <div v-if="icon" class="mb-3 text-3xl text-slate-300" aria-hidden="true">{{ icon }}</div>
    <p class="text-sm font-medium text-slate-600">{{ title }}</p>
    <p v-if="description" class="mt-1 text-xs text-slate-400">{{ description }}</p>
    <div v-if="$slots.action" class="mt-4">
      <slot name="action" />
    </div>
  </div>
</template>
