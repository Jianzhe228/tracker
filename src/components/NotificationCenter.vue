<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';

import type { NotificationLogItem } from '../types/domain';
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadCount,
} from '../services/commands/notification';
import { useAiStore } from '../stores/aiStore';
import { usePredictionStore } from '../stores/predictionStore';

const isTauri = '__TAURI_INTERNALS__' in window;
const aiStore = useAiStore();
const predictionStore = usePredictionStore();

const open = ref(false);
const unreadCount = ref(0);
const notifications = ref<NotificationLogItem[]>([]);
const panelRef = ref<HTMLElement | null>(null);

const totalBadge = computed(() =>
  unreadCount.value + aiStore.pendingJobs.length + predictionStore.pendingPredictions.length
);

let pollInterval: ReturnType<typeof setInterval> | null = null;

async function refreshUnreadCount(): Promise<void> {
  if (!isTauri) return;
  try {
    unreadCount.value = await getUnreadCount();
  } catch (e) {
    console.error('[notification-center] failed to get unread count', e);
  }
}

async function loadNotifications(): Promise<void> {
  if (!isTauri) return;
  try {
    notifications.value = await listNotifications(30);
    await refreshUnreadCount();
  } catch (e) {
    console.error('[notification-center] failed to load notifications', e);
  }
}

function toggle(): void {
  open.value = !open.value;
  if (open.value) {
    loadNotifications();
  }
}

async function handleMarkRead(id: number): Promise<void> {
  if (!isTauri) return;
  try {
    await markNotificationRead(id);
    const item = notifications.value.find(n => n.id === id);
    if (item) {
      item.isRead = true;
      item.readAt = new Date().toISOString();
    }
    unreadCount.value = Math.max(0, unreadCount.value - 1);
  } catch (e) {
    console.error('[notification-center] failed to mark read', e);
  }
}

async function handleMarkAllRead(): Promise<void> {
  if (!isTauri) return;
  try {
    await markAllNotificationsRead();
    for (const n of notifications.value) {
      if (!n.isRead) {
        n.isRead = true;
        n.readAt = new Date().toISOString();
      }
    }
    unreadCount.value = 0;
  } catch (e) {
    console.error('[notification-center] failed to mark all read', e);
  }
}

function formatTime(iso: string): string {
  // SQLite CURRENT_TIMESTAMP returns UTC without timezone suffix (e.g. "2026-02-19 10:30:00").
  // Append 'Z' so JS Date parses it as UTC instead of local time.
  const normalized = iso.endsWith('Z') || iso.includes('+') || iso.includes('T') ? iso : iso + 'Z';
  const date = new Date(normalized);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} 天前`;
}

function getSkillName(skillId: number): string {
  const skill = aiStore.skills.find((s) => s.id === skillId);
  return skill?.name ?? 'AI';
}

function getActionLabel(type: string): string {
  switch (type) {
    case 'create_subtask': return '创建子任务';
    case 'create_task': return '创建任务';
    case 'update_task': return '更新任务';
    case 'send_notification': return '发送通知';
    default: return type;
  }
}

function getJobTargetTitle(job: { inputContext: Record<string, unknown> }): string {
  const title = job.inputContext.taskTitle;
  return typeof title === 'string' ? title : '';
}

function handleClickOutside(event: MouseEvent): void {
  if (panelRef.value && !panelRef.value.contains(event.target as Node)) {
    open.value = false;
  }
}

onMounted(() => {
  refreshUnreadCount();
  void predictionStore.refreshPredictions();
  pollInterval = setInterval(refreshUnreadCount, 30_000);
  document.addEventListener('click', handleClickOutside, true);
});

onUnmounted(() => {
  if (pollInterval) clearInterval(pollInterval);
  document.removeEventListener('click', handleClickOutside, true);
});
</script>

<template>
  <div ref="panelRef" class="relative">
    <!-- Bell button -->
    <button
      class="relative flex h-8 w-8 items-center justify-center rounded-lg text-[#9E9E9A] transition-colors hover:bg-surface-hover hover:text-[#6F6F6B]"
      aria-label="通知中心"
      @click.stop="toggle"
    >
      <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
      <span
        v-if="totalBadge > 0"
        class="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-500 px-1 text-[10px] font-bold text-white"
      >
        {{ totalBadge > 99 ? '99+' : totalBadge }}
      </span>
    </button>

    <!-- Dropdown panel -->
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="scale-95 opacity-0"
      enter-to-class="scale-100 opacity-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="scale-100 opacity-100"
      leave-to-class="scale-95 opacity-0"
    >
      <div
        v-if="open"
        class="absolute bottom-full left-0 z-50 mb-2 w-80 rounded-xl border border-surface-border bg-white shadow-lg"
      >
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-surface-border px-4 py-3">
          <h3 class="text-sm font-semibold text-[#1C1C1A]">通知</h3>
          <button
            v-if="unreadCount > 0"
            class="text-xs text-primary-500 hover:text-primary-700"
            @click="handleMarkAllRead"
          >
            全部标记已读
          </button>
        </div>

        <!-- Task Predictions -->
        <div v-if="predictionStore.pendingPredictions.length > 0">
          <div class="border-b border-surface-border bg-sky-50/80 px-4 py-2">
            <span class="text-xs font-semibold text-sky-700">任务预测</span>
          </div>
          <div
            v-for="prediction in predictionStore.pendingPredictions"
            :key="'prediction-' + prediction.id"
            class="border-b border-surface-border px-4 py-3"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-[#1C1C1A]">{{ prediction.title }}</p>
                <p v-if="prediction.reason" class="mt-1 text-xs leading-5 text-[#6F6F6B]">
                  {{ prediction.reason }}
                </p>
              </div>
              <div class="flex shrink-0 gap-1.5">
                <button
                  class="rounded bg-sky-600 px-2 py-0.5 text-[11px] font-medium text-white transition-colors hover:bg-sky-700"
                  @click="predictionStore.acceptPrediction(prediction.id)"
                >
                  创建
                </button>
                <button
                  class="rounded border border-surface-border px-2 py-0.5 text-[11px] font-medium text-[#6F6F6B] transition-colors hover:bg-surface-hover"
                  @click="predictionStore.rejectPrediction(prediction.id)"
                >
                  忽略
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- AI Pending Actions -->
        <div v-if="aiStore.pendingJobs.length > 0">
          <div class="border-b border-surface-border bg-violet-50/60 px-4 py-2">
            <span class="text-xs font-semibold text-violet-700">待确认</span>
          </div>
          <div
            v-for="job in aiStore.pendingJobs"
            :key="'ai-' + job.id"
            class="border-b border-surface-border px-4 py-3"
          >
            <div class="flex items-center justify-between">
              <div class="min-w-0">
                <span class="text-xs font-semibold text-violet-600">{{ getSkillName(job.skillId) }}</span>
                <p v-if="getJobTargetTitle(job)" class="mt-0.5 truncate text-[11px] text-[#9E9E9A]">
                  目标任务：{{ getJobTargetTitle(job) }}
                </p>
              </div>
              <div class="flex gap-1.5">
                <button
                  class="rounded bg-violet-600 px-2 py-0.5 text-[11px] font-medium text-white transition-colors hover:bg-violet-700"
                  @click="aiStore.approveJob(job.id)"
                >
                  全部确认
                </button>
                <button
                  class="rounded border border-surface-border px-2 py-0.5 text-[11px] font-medium text-[#6F6F6B] transition-colors hover:bg-surface-hover"
                  @click="aiStore.rejectJob(job.id)"
                >
                  忽略
                </button>
              </div>
            </div>
            <div v-if="job.actions" class="mt-2 space-y-1">
              <div
                v-for="(action, idx) in job.actions.filter(a => a.status === 'pending')"
                :key="idx"
                class="flex items-center justify-between gap-2 rounded-md bg-white px-2 py-1.5 text-xs"
              >
                <div class="min-w-0 flex-1">
                  <span class="font-medium text-[#6F6F6B]">{{ getActionLabel(action.type) }}</span>
                  <span v-if="action.params.title" class="ml-1 text-[#6F6F6B]">{{ action.params.title }}</span>
                </div>
                <div class="flex shrink-0 gap-1">
                  <button
                    class="rounded px-1.5 py-0.5 text-[10px] font-medium text-success-500 transition-colors hover:bg-success-50"
                    @click="aiStore.approveAction(job.id, job.actions!.indexOf(action))"
                  >
                    确认
                  </button>
                  <button
                    class="rounded px-1.5 py-0.5 text-[10px] font-medium text-[#9E9E9A] transition-colors hover:bg-surface-hover"
                    @click="aiStore.rejectAction(job.id, job.actions!.indexOf(action))"
                  >
                    忽略
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Processing indicator -->
        <div v-if="aiStore.processingCount > 0" class="flex items-center gap-2 border-b border-surface-border px-4 py-2">
          <span class="h-2 w-2 animate-pulse rounded-full bg-violet-400" />
          <span class="text-xs text-violet-600">正在分析...</span>
        </div>

        <div v-if="predictionStore.isAnalyzing" class="flex items-center gap-2 border-b border-surface-border px-4 py-2">
          <span class="h-2 w-2 animate-pulse rounded-full bg-sky-400" />
          <span class="text-xs text-sky-600">预测更新中...</span>
        </div>

        <!-- Notification list -->
        <div class="max-h-72 overflow-y-auto">
          <div
            v-if="notifications.length === 0 && aiStore.pendingJobs.length === 0 && predictionStore.pendingPredictions.length === 0"
            class="px-4 py-8 text-center text-sm text-[#9E9E9A]"
          >
            暂无通知
          </div>
          <div
            v-for="item in notifications"
            :key="item.id"
            class="flex cursor-pointer gap-3 border-b border-surface-border px-4 py-3 transition-colors last:border-b-0 hover:bg-surface-hover"
            :class="item.isRead ? 'opacity-60' : ''"
            @click="!item.isRead && handleMarkRead(item.id)"
          >
            <div class="mt-0.5 shrink-0">
              <span
                class="block h-2 w-2 rounded-full"
                :class="item.isRead ? 'bg-transparent' : 'bg-primary-500'"
              />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-[#1C1C1A]">{{ item.title }}</p>
              <p class="mt-0.5 text-xs text-[#6F6F6B]">{{ item.body }}</p>
              <p class="mt-1 text-xs text-[#9E9E9A]">{{ formatTime(item.createdAt) }}</p>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
