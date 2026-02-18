<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue';

export interface MenuItem {
  key: string;
  label: string;
  danger?: boolean;
}

const props = defineProps<{
  x: number;
  y: number;
  items: MenuItem[];
}>();

const emit = defineEmits<{
  select: [key: string];
  close: [];
}>();

const menuEl = ref<HTMLElement | null>(null);
const adjustedX = ref(props.x);
const adjustedY = ref(props.y);

function onClickOutside(e: MouseEvent) {
  if (menuEl.value && !menuEl.value.contains(e.target as Node)) {
    emit('close');
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close');
  }
}

function select(key: string) {
  emit('select', key);
  emit('close');
}

onMounted(async () => {
  document.addEventListener('mousedown', onClickOutside, true);
  document.addEventListener('keydown', onKeydown);
  await nextTick();
  if (menuEl.value) {
    const rect = menuEl.value.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      adjustedX.value = window.innerWidth - rect.width - 8;
    }
    if (rect.bottom > window.innerHeight) {
      adjustedY.value = window.innerHeight - rect.height - 8;
    }
  }
});

onUnmounted(() => {
  document.removeEventListener('mousedown', onClickOutside, true);
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div
      ref="menuEl"
      class="fixed z-[60] min-w-[120px] rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
      :style="{ left: adjustedX + 'px', top: adjustedY + 'px' }"
    >
      <button
        v-for="item in items"
        :key="item.key"
        class="flex w-full items-center px-3 py-1.5 text-left text-sm transition-colors hover:bg-slate-50"
        :class="item.danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700'"
        @click="select(item.key)"
      >
        {{ item.label }}
      </button>
    </div>
  </Teleport>
</template>
