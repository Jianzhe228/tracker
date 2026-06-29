import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ConfirmOptions = {
  title?: string;
  confirmText?: string;
  cancelText?: string;
};

type NoticeState = {
  id: number;
  message: string;
};

type ConfirmState = {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  resolve: (value: boolean) => void;
};

const NOTICE_DURATION_MS = 2600;

export const useUiStore = defineStore('ui', () => {
  const notice = ref<NoticeState | null>(null);
  const confirmDialog = ref<ConfirmState | null>(null);
  const selectedTaskId = ref<number | null>(null);

  function setSelectedTaskId(id: number | null): void {
    selectedTaskId.value = id;
  }

  let noticeIdSeed = 0;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;

  function clearNoticeTimer(): void {
    if (!noticeTimer) return;
    clearTimeout(noticeTimer);
    noticeTimer = null;
  }

  function notify(message: string, durationMs: number = NOTICE_DURATION_MS): void {
    clearNoticeTimer();
    noticeIdSeed += 1;
    notice.value = {
      id: noticeIdSeed,
      message,
    };
    noticeTimer = window.setTimeout(() => {
      notice.value = null;
      noticeTimer = null;
    }, Math.max(800, durationMs));
  }

  function dismissNotice(): void {
    clearNoticeTimer();
    notice.value = null;
  }

  function confirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
    if (confirmDialog.value) {
      confirmDialog.value.resolve(false);
    }

    return new Promise((resolve) => {
      confirmDialog.value = {
        title: options.title || '确认操作',
        message,
        confirmText: options.confirmText || '确认',
        cancelText: options.cancelText || '取消',
        resolve,
      };
    });
  }

  function resolveConfirm(confirmed: boolean): void {
    const current = confirmDialog.value;
    if (!current) return;
    confirmDialog.value = null;
    current.resolve(confirmed);
  }

  return {
    notice,
    confirmDialog,
    selectedTaskId,
    setSelectedTaskId,
    notify,
    dismissNotice,
    confirm,
    resolveConfirm,
  };
});
