<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue';
import type { ProjectItem } from '../types/domain';

const props = defineProps<{
  project: ProjectItem | null;
  anchorEl: HTMLElement | null;
}>();

const emit = defineEmits<{
  save: [data: { title: string; color: string }];
  close: [];
}>();

const PRESET_COLORS = [
  '#6b7280', '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#14b8a6', '#3b82f6', '#6366f1', '#a855f7', '#ec4899',
];

const title = ref(props.project?.title ?? '');
const selectedColor = ref(props.project?.color ?? PRESET_COLORS[0]);
const popoverEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);
const posX = ref(0);
const posY = ref(0);

function computePosition() {
  if (!props.anchorEl) return;
  const rect = props.anchorEl.getBoundingClientRect();
  posX.value = rect.left;
  posY.value = rect.bottom + 4;
}

function adjustPosition() {
  if (!popoverEl.value) return;
  const rect = popoverEl.value.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    posX.value = window.innerWidth - rect.width - 8;
  }
  if (posX.value < 8) posX.value = 8;
  if (rect.bottom > window.innerHeight) {
    // Position above anchor instead
    if (props.anchorEl) {
      const anchorRect = props.anchorEl.getBoundingClientRect();
      posY.value = anchorRect.top - rect.height - 4;
    }
  }
}

function onClickOutside(e: MouseEvent) {
  if (popoverEl.value && !popoverEl.value.contains(e.target as Node)) {
    emit('close');
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close');
  }
}

function submit() {
  const trimmed = title.value.trim();
  if (!trimmed) return;
  emit('save', { title: trimmed, color: selectedColor.value });
}

onMounted(async () => {
  computePosition();
  document.addEventListener('mousedown', onClickOutside, true);
  document.addEventListener('keydown', onKeydown);
  await nextTick();
  adjustPosition();
  inputEl.value?.focus();
});

onUnmounted(() => {
  document.removeEventListener('mousedown', onClickOutside, true);
  document.removeEventListener('keydown', onKeydown);
});

watch(() => props.anchorEl, () => {
  computePosition();
  nextTick(adjustPosition);
});
</script>

<template>
  <Teleport to="body">
    <div
      ref="popoverEl"
      class="fixed z-[60] w-56 rounded-lg border border-surface-border bg-white p-3 shadow-lg"
      :style="{ left: posX + 'px', top: posY + 'px' }"
    >
      <!-- Title input -->
      <input
        ref="inputEl"
        v-model="title"
        type="text"
        class="mb-3 w-full rounded border border-surface-border px-2 py-1.5 text-sm outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-400"
        placeholder="清单名称"
        maxlength="50"
        @keydown.enter="submit"
      />
      <!-- Color palette -->
      <div class="mb-3 flex flex-wrap gap-1.5">
        <button
          v-for="color in PRESET_COLORS"
          :key="color"
          class="h-5 w-5 rounded-full border-2 transition-transform hover:scale-110"
          :class="selectedColor === color ? 'border-[#1C1C1A]' : 'border-transparent'"
          :style="{ backgroundColor: color }"
          @click="selectedColor = color"
        />
      </div>
      <!-- Actions -->
      <div class="flex justify-end gap-2">
        <button
          class="rounded px-3 py-1 text-xs text-[#6F6F6B] hover:bg-surface-hover"
          @click="emit('close')"
        >
          取消
        </button>
        <button
          class="rounded bg-primary-500 px-3 py-1 text-xs text-white hover:bg-primary-600 disabled:opacity-50"
          :disabled="!title.trim()"
          @click="submit"
        >
          {{ project ? '保存' : '创建' }}
        </button>
      </div>
    </div>
  </Teleport>
</template>
