<script setup lang="ts">
defineProps<{
  title: string;
  description?: string;
  icon?: string;
}>();
</script>

<template>
  <div class="flex flex-col items-center justify-center py-10 text-center">
    <div v-if="icon" class="mb-3 text-3xl text-[#9E9E9A]" aria-hidden="true">{{ icon }}</div>
    <p class="text-sm font-medium text-[#6F6F6B]">{{ title }}</p>
    <p v-if="description" class="mt-1 text-xs text-[#9E9E9A]">{{ description }}</p>
    <div v-if="$slots.action" class="mt-4">
      <slot name="action" />
    </div>
  </div>
</template>
