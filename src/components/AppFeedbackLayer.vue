<script setup lang="ts">
import { useTaskStore } from '../stores/taskStore';
import { useUiStore } from '../stores/uiStore';

const uiStore = useUiStore();
// The undo-deletion toast owns the bottom-center spot — shift notices up
// while it is visible so the 10s undo window never gets covered.
const taskStore = useTaskStore();

function handleOverlayClick(event: MouseEvent): void {
  if (event.target !== event.currentTarget) return;
  uiStore.resolveConfirm(false);
}
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-200 ease-out"
    enter-from-class="translate-y-2 opacity-0"
    enter-to-class="translate-y-0 opacity-100"
    leave-active-class="transition-all duration-150 ease-in"
    leave-from-class="translate-y-0 opacity-100"
    leave-to-class="translate-y-2 opacity-0"
  >
    <div
      v-if="uiStore.notice"
      :key="uiStore.notice.id"
      class="pointer-events-none fixed left-1/2 z-[100] -translate-x-1/2 rounded-lg border border-surface-border bg-white px-4 py-2.5 text-sm text-[#1C1C1A] shadow-xl"
      :class="taskStore.pendingUndoDeletion ? 'bottom-20' : 'bottom-6'"
    >
      {{ uiStore.notice.message }}
    </div>
  </Transition>

  <Transition
    enter-active-class="transition duration-150 ease-out"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition duration-120 ease-in"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="uiStore.confirmDialog"
      class="fixed inset-0 z-[110] flex items-center justify-center bg-[#1C1C1A]/30 px-4"
      @click="handleOverlayClick"
    >
      <div class="w-full max-w-md rounded-xl border border-surface-border bg-white shadow-2xl">
        <div class="border-b border-surface-border px-5 py-3 text-sm font-semibold text-[#1C1C1A]">
          {{ uiStore.confirmDialog.title }}
        </div>
        <div class="px-5 py-4 text-sm text-[#6F6F6B]">
          {{ uiStore.confirmDialog.message }}
        </div>
        <div class="flex items-center justify-end gap-2 border-t border-surface-border px-5 py-3">
          <button
            class="rounded px-3 py-1.5 text-sm text-[#6F6F6B] hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
            @click="uiStore.resolveConfirm(false)"
          >
            {{ uiStore.confirmDialog.cancelText }}
          </button>
          <button
            class="rounded bg-primary-600 px-3 py-1.5 text-sm text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
            @click="uiStore.resolveConfirm(true)"
          >
            {{ uiStore.confirmDialog.confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
