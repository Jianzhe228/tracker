<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { useTimerStore } from '../stores/timerStore';
import { useTaskStore } from '../stores/taskStore';
import { useUiStore } from '../stores/uiStore';
import { useFocusModal } from '../composables/useFocusModal';
import { useTaskToggle } from '../composables/useTaskToggle';
import { toDateKey, todayDateKey } from '../utils/date';
import { isTaskActiveOnDate } from '../utils/taskFilters';
import { useWhiteNoise, SOUNDS } from '../composables/useWhiteNoise';

const timerStore = useTimerStore();
const taskStore = useTaskStore();
const uiStore = useUiStore();
const { visible, close } = useFocusModal();
const { activeSoundId, volume: soundVolume, selectSound, setVolume, stopForTimer, resumeLastSound } = useWhiteNoise();
const { toggleTaskWithFlow } = useTaskToggle();

// 层级导航状态
const selectedParentId = ref<number | null>(null);

// 获取今天的日期字符串 YYYY-MM-DD（本地时区，与任务列表口径一致）
function getTodayKey(): string {
  return todayDateKey();
}

// completedAt 是时间戳，需解析后按本地日期比较（与 TasksView.isCompletedToday 一致）
function isCompletedOn(dateKey: string, completedAt: string | null): boolean {
  if (completedAt == null) return false;
  const date = new Date(completedAt);
  if (Number.isNaN(date.getTime())) return false;
  return toDateKey(date) === dateKey;
}

// 今日父任务（无父任务 + 今天落在 [开始/创建日, 截止日] 区间内）
const todayParentTasks = computed(() => {
  const today = getTodayKey();
  return taskStore.tasks.filter(t =>
    t.status === 'todo' &&
    t.parentId === null &&
    isTaskActiveOnDate(t, today)
  );
});

// 今日已完成的父任务（completedAt 是今天）
const todayDoneParentTasks = computed(() => {
  const today = getTodayKey();
  return taskStore.tasks.filter(t =>
    t.status === 'done' &&
    t.parentId === null &&
    isCompletedOn(today, t.completedAt)
  );
});

// 今日有子任务完成但父任务尚未完成的父任务
const todayInProgressParentTasks = computed(() => {
  const today = getTodayKey();
  return taskStore.tasks.filter(t => {
    if (t.status !== 'todo' || t.parentId !== null) return false;
    const subtasks = taskStore.tasks.filter(s => s.parentId === t.id);
    return subtasks.some(s => s.status === 'done' && isCompletedOn(today, s.completedAt));
  });
});

// 获取某个父任务今日完成的子任务统计
function getTodaySubtaskStats(parentId: number): { done: number; total: number; doneTitles: string[] } {
  const today = getTodayKey();
  const subtasks = taskStore.tasks.filter(t => t.parentId === parentId);
  const doneToday = subtasks.filter(t => t.status === 'done' && isCompletedOn(today, t.completedAt));
  return {
    done: doneToday.length,
    total: subtasks.length,
    doneTitles: doneToday.map(t => t.title),
  };
}

// 当前选中父任务的子任务
const currentSubtasks = computed(() => {
  if (selectedParentId.value === null) return [];
  return taskStore.tasks.filter(t => t.parentId === selectedParentId.value);
});

// 选中的父任务
const selectedParent = computed(() => {
  if (selectedParentId.value === null) return null;
  return taskStore.tasks.find(t => t.id === selectedParentId.value) ?? null;
});

function enterSubtasks(taskId: number) {
  selectedParentId.value = taskId;
}

function goBack() {
  selectedParentId.value = null;
}

// 检查任务是否有子任务
function hasSubtasks(taskId: number): boolean {
  return taskStore.tasks.some(t => t.parentId === taskId);
}

// 获取直接子任务的完成统计
function getSubtaskCounts(taskId: number): { done: number; total: number } {
  const subs = taskStore.tasks.filter(t => t.parentId === taskId);
  const done = subs.filter(t => t.status === 'done' || t.status === 'cancelled').length;
  return { done, total: subs.length };
}

// 检查父任务的所有直接子任务是否都已完成 → 已收敛进 useTaskToggle 共享流程

// 当前关联任务是否已完成
const isCurrentTaskDone = computed(() => {
  if (!timerStore.currentTaskId) return false;
  const task = taskStore.tasks.find(t => t.id === timerStore.currentTaskId);
  return task?.status === 'done';
});

const pauseDurationText = computed(() => {
  const minutes = Math.floor(timerStore.pauseDurationSeconds / 60);
  const seconds = timerStore.pauseDurationSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
});
const focusMinutesToday = computed(() =>
  Math.floor((timerStore.focusSecondsToday + timerStore.currentSegmentFocusSeconds) / 60)
);
const isBreakMode = computed(() => timerStore.mode !== 'focus');
const timerKindLabel = computed(() => timerStore.timerKind === 'countdown' ? '倒计时' : '正计时');

// Circle progress
const circumference = 2 * Math.PI * 140;
const displayHasHours = computed(() => timerStore.display.includes(':') && timerStore.display.split(':').length > 2);
const displayFontClass = computed(() => {
  const len = timerStore.display.length;
  if (len <= 5) return 'text-6xl';     // MM:SS
  if (len <= 7) return 'text-5xl';     // H:MM:SS
  if (len <= 8) return 'text-4xl';     // HH:MM:SS
  if (len <= 9) return 'text-3xl';     // HHH:MM:SS
  return 'text-2xl';                    // 溢出保护
});
const strokeDashoffset = computed(() => {
  return circumference - ((timerStore.progress ?? 0) / 100) * circumference;
});

function selectTask(taskId: number, taskTitle: string, projectId: number | null = null) {
  timerStore.setTask(taskId, taskTitle, projectId);
}

function clearSelectedTask() {
  timerStore.clearTask();
}

function handleStart() {
  timerStore.start();
}

function handlePause() {
  timerStore.pause();
}

function handleResume() {
  timerStore.resume();
}

function handleSkipBreak() {
  timerStore.skipBreak();
}

function handleExtendBreak() {
  const ok = timerStore.extendBreak();
  if (!ok) {
    uiStore.notify('休息最多可延长 3 次');
  }
}

async function handleStop() {
  const message = timerStore.mode === 'focus' ? '确定结束本次计时吗？' : '确定结束当前休息吗？';
  const confirmed = await uiStore.confirm(message, { title: '结束计时' });
  if (!confirmed) return;
  timerStore.stop();
}

function handleClose() {
  close();
}

function priorityCheckboxClass(priority: number): string {
  switch (priority) {
    case 3: return 'border-red-400 ring-1 ring-red-400/30';
    case 2: return 'border-warning-400 ring-1 ring-warning-400/30';
    case 1: return 'border-primary-400 ring-1 ring-primary-400/30';
    default: return 'border-[#6F6F6B]';
  }
}

async function toggleTask(e: Event, taskId: number): Promise<void> {
  e.stopPropagation();
  await toggleTaskWithFlow(taskId, (message) => uiStore.confirm(message, { title: '子任务已全部完成' }));
}

// Handle ESC key
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    handleClose();
  }
}

// Focus trap — keep Tab focus cycling inside the modal
const modalRoot = ref<HTMLDivElement | null>(null);
let previousActive: HTMLElement | null = null;

function getFocusables(): HTMLElement[] {
  if (!modalRoot.value) return [];
  return Array.from(
    modalRoot.value.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => el.offsetParent !== null);
}

function handleTab(e: KeyboardEvent) {
  if (e.key !== 'Tab') return;
  const focusables = getFocusables();
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (e.shiftKey && (active === first || !modalRoot.value?.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

watch(visible, (show) => {
  if (show) {
    previousActive = document.activeElement as HTMLElement | null;
    document.addEventListener('keydown', handleKeydown);
    document.addEventListener('keydown', handleTab);
    // Pre-select task from task list selection when timer is idle
    if (timerStore.idle && uiStore.selectedTaskId) {
      const task = taskStore.tasks.find(t => t.id === uiStore.selectedTaskId);
      if (task) {
        timerStore.setTask(task.id, task.title, task.projectId ?? null);
      }
    }
    nextTick(() => {
      const focusables = getFocusables();
      focusables[0]?.focus();
    });
  } else {
    document.removeEventListener('keydown', handleKeydown);
    document.removeEventListener('keydown', handleTab);
    previousActive?.focus?.();
    previousActive = null;
  }
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
  document.removeEventListener('keydown', handleTab);
});

// Sync white noise with timer running state — stop on pause/end, resume on start/unpause
watch(() => timerStore.running, (isRunning, wasRunning) => {
  if (wasRunning && !isRunning) stopForTimer();
  else if (!wasRunning && isRunning) resumeLastSound();
});

// Stop when focus completes and auto-starts a break (running stays true, only mode changes)
watch(() => timerStore.mode, (next, prev) => {
  if (prev === 'focus' && next !== 'focus') stopForTimer();
});
</script>

<template>
  <Teleport to="body">
    <Transition name="focus-modal">
    <div
      v-if="visible"
      ref="modalRoot"
      role="dialog"
      aria-modal="true"
      aria-label="专注模式"
      class="fixed inset-0 z-50 flex overscroll-contain"
    >
      <!-- Main Focus Area -->
      <div class="relative flex flex-1 flex-col items-center justify-center bg-[#1C1C1A]">
        <!-- Background Gradient -->
        <div
          class="absolute inset-0 bg-gradient-to-br from-[#1C1C1A] via-[#252523] to-primary-950"
        />

        <!-- Timer Kind -->
        <div v-if="timerStore.mode === 'focus'" class="relative z-10 mb-6 flex gap-2">
          <button
            class="rounded-full bg-white/10 px-4 py-2 text-xs text-white transition-colors hover:bg-white/20"
            :class="timerStore.timerKind === 'countdown' ? 'ring-2 ring-white/50' : ''"
            :disabled="!timerStore.idle"
            @click="timerStore.setTimerKind('countdown')"
          >
            倒计时
          </button>
          <button
            class="rounded-full bg-white/10 px-4 py-2 text-xs text-white transition-colors hover:bg-white/20"
            :class="timerStore.timerKind === 'countup' ? 'ring-2 ring-white/50' : ''"
            :disabled="!timerStore.idle"
            @click="timerStore.setTimerKind('countup')"
          >
            正计时
          </button>
        </div>

        <!-- Close Button -->
        <button
          class="absolute left-4 top-4 z-20 flex items-center gap-1 rounded-full bg-black/20 px-3 py-1.5 text-sm text-white/80 backdrop-blur transition-colors hover:bg-black/35 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          aria-label="关闭专注模式"
          @click="handleClose"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
          返回
        </button>

        <!-- Task Selector -->
        <div class="relative z-10 mb-8">
          <div class="flex items-center gap-3 rounded-full bg-white/10 px-4 py-2 backdrop-blur">
            <!-- 任务状态圆圈 -->
            <span
              v-if="timerStore.currentTaskId && isCurrentTaskDone"
              class="flex h-5 w-5 items-center justify-center rounded-full bg-success-500"
              aria-hidden="true"
            >
              <svg class="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
              </svg>
            </span>
            <span v-else class="flex h-5 w-5 items-center justify-center rounded-full border-2 border-white/40" aria-hidden="true" />
            <span v-if="!timerStore.currentTaskTitle" class="w-48 text-sm text-white/50">
              从右侧任务列表中选择…
            </span>
            <span v-else class="text-sm" :class="isCurrentTaskDone ? 'text-white/50 line-through' : 'text-white'">{{ timerStore.currentTaskTitle }}</span>
            <button
              v-if="timerStore.currentTaskTitle"
              class="ml-2 text-white/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              aria-label="清除当前任务"
              @click="clearSelectedTask"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Timer Circle -->
        <div class="relative z-10 mb-8">
          <svg class="h-72 w-72 -rotate-90 transform" viewBox="0 0 300 300" aria-hidden="true">
            <!-- Tick marks -->
            <g v-for="i in 60" :key="i">
              <line
                :x1="150 + 130 * Math.cos((i * 6 - 90) * Math.PI / 180)"
                :y1="150 + 130 * Math.sin((i * 6 - 90) * Math.PI / 180)"
                :x2="150 + (i % 5 === 0 ? 120 : 125) * Math.cos((i * 6 - 90) * Math.PI / 180)"
                :y2="150 + (i % 5 === 0 ? 120 : 125) * Math.sin((i * 6 - 90) * Math.PI / 180)"
                :stroke="i % 5 === 0 ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.2)'"
                :stroke-width="i % 5 === 0 ? 2 : 1"
              />
            </g>
            <!-- Progress circle -->
            <circle
              cx="150"
              cy="150"
              r="140"
              fill="none"
              stroke="rgba(255,255,255,0.1)"
              stroke-width="4"
            />
            <circle
              v-if="timerStore.timerKind === 'countdown'"
              cx="150"
              cy="150"
              r="140"
              fill="none"
              :stroke="timerStore.mode === 'focus' ? '#10b981' : '#3b82f6'"
              stroke-width="4"
              stroke-linecap="round"
              :stroke-dasharray="circumference"
              :stroke-dashoffset="strokeDashoffset"
              class="transition-[stroke-dashoffset] duration-1000 ease-linear"
            />
          </svg>
        <!-- Timer Display -->
        <div class="absolute inset-0 flex flex-col items-center justify-center px-8">
          <span class="max-w-full truncate text-center font-mono tabular-nums tracking-wider text-white" :class="displayFontClass" :style="{ fontWeight: displayHasHours ? 400 : 300 }">
            {{ timerStore.display }}
          </span>
          <span class="mt-2 text-sm text-white/60">{{ timerStore.mode === 'focus' ? timerKindLabel : timerStore.modeLabel }}</span>
        </div>
      </div>

        <!-- Control Button -->
        <div class="relative z-10">
          <template v-if="timerStore.idle">
            <button
              class="flex items-center gap-2 rounded-full bg-white/10 px-8 py-3 text-white backdrop-blur transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              @click="handleStart"
            >
              <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
              <span>开始专注</span>
            </button>
          </template>
          <template v-else-if="timerStore.running">
            <div class="flex gap-4">
              <button
                class="flex items-center gap-2 rounded-full bg-white/10 px-6 py-3 text-white backdrop-blur transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                @click="handlePause"
              >
                <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
                <span>暂停</span>
              </button>
              <button
                class="flex items-center gap-2 rounded-full bg-red-500/20 px-6 py-3 text-red-400 backdrop-blur transition-colors hover:bg-red-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40"
                @click="handleStop"
              >
                <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6h12v12H6z" />
                </svg>
                <span>{{ timerStore.mode === 'focus' ? '结束' : '结束休息' }}</span>
              </button>
            </div>
          </template>
          <template v-else-if="timerStore.paused">
            <div class="flex gap-4">
              <button
                class="flex items-center gap-2 rounded-full bg-success-500/20 px-6 py-3 text-success-400 backdrop-blur transition-colors hover:bg-success-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success-400/40"
                @click="handleResume"
              >
                <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 5v14l11-7z" />
                </svg>
                <span>继续</span>
              </button>
              <button
                class="flex items-center gap-2 rounded-full bg-red-500/20 px-6 py-3 text-red-400 backdrop-blur transition-colors hover:bg-red-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40"
                @click="handleStop"
              >
                <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6h12v12H6z" />
                </svg>
                <span>{{ timerStore.mode === 'focus' ? '结束' : '结束休息' }}</span>
              </button>
            </div>
          </template>
        </div>

        <!-- Pause Info -->
        <div v-if="timerStore.paused" class="relative z-10 mt-4 text-center text-sm text-white/70">
          <div>已暂停 {{ pauseDurationText }}</div>
          <div v-if="timerStore.pauseWarning" class="text-warning-300">暂停超过 30 分钟，请尽快恢复或结束</div>
        </div>

        <!-- Break Controls -->
        <div v-if="isBreakMode" class="relative z-10 mt-4 flex items-center gap-4 text-sm text-white/70">
          <button class="rounded-full bg-white/10 px-4 py-2 transition-colors hover:bg-white/20" @click="handleSkipBreak">
            跳过休息
          </button>
          <button
            class="rounded-full bg-white/10 px-4 py-2 transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="timerStore.breakExtendCount >= 3"
            @click="handleExtendBreak"
          >
            延长休息 (+5 分钟) · 已用 {{ timerStore.breakExtendCount }}/3
          </button>
        </div>
      </div>

      <!-- Right Sidebar -->
      <div class="flex w-80 flex-col bg-[#1C1C1A] border-l border-white/5">
        <!-- Focus Time Today -->
        <section class="px-5 py-6 border-b border-white/5">
          <div class="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white/50">
            <span class="h-3 w-0.5 rounded-full bg-success-400/80" aria-hidden="true" />
            今日专注时间
          </div>
          <div class="mt-3 flex items-baseline gap-2 tabular-nums text-white">
            <span class="text-4xl font-extralight">{{ focusMinutesToday }}</span>
            <span class="text-sm text-white/50">分钟</span>
          </div>
        </section>

        <!-- Today Tasks -->
        <div class="flex-1 overflow-auto">
          <section class="px-5 py-5 border-b border-white/5">
            <!-- 父任务视图 -->
            <template v-if="selectedParentId === null">
              <div class="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white/50">
                <span class="h-3 w-0.5 rounded-full bg-warning-400/80" aria-hidden="true" />
                今日任务
              </div>
              <ul class="mt-3 space-y-1.5 max-h-64 overflow-y-auto">
                <li
                  v-for="task in todayParentTasks"
                  :key="task.id"
                >
                  <div
                    class="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors cursor-pointer"
                    :class="timerStore.currentTaskId === task.id ? 'bg-white/10 ring-1 ring-success-400/40' : 'hover:bg-white/5'"
                    @click="selectTask(task.id, task.title, task.projectId)"
                  >
                    <button
                      role="checkbox"
                      :aria-checked="task.status === 'done'"
                      :aria-label="task.status === 'done' ? '标记为未完成' : '标记为已完成'"
                      class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                      :class="task.status === 'done'
                        ? 'border-success-500 bg-success-500'
                        : 'border-white/30 hover:border-white/60'"
                      @click.stop="toggleTask($event, task.id)"
                    >
                      <svg v-if="task.status === 'done'" class="h-2.5 w-2.5 text-white" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                      </svg>
                    </button>
                    <span class="min-w-0 flex-1 truncate text-sm text-white/90">{{ task.title }}</span>
                    <span
                      v-if="hasSubtasks(task.id)"
                      class="shrink-0 rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/60"
                    >
                      {{ getSubtaskCounts(task.id).done }}/{{ getSubtaskCounts(task.id).total }}
                    </span>
                    <button
                      v-if="hasSubtasks(task.id)"
                      class="flex h-5 w-5 items-center justify-center rounded text-white/30 hover:text-white/70"
                      :aria-label="`查看 ${task.title} 的子任务`"
                      @click.stop="enterSubtasks(task.id)"
                    >
                      <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </li>
                <li v-if="todayParentTasks.length === 0" class="py-4 text-center text-xs text-white/30">
                  今日暂无待办任务
                </li>
              </ul>
            </template>

            <!-- 子任务视图 -->
            <template v-else>
              <button
                class="flex items-center gap-1 text-xs text-white/50 hover:text-white/90 transition-colors"
                @click="goBack"
              >
                <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                </svg>
                返回
              </button>
              <div class="mt-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white/50">
                <span class="h-3 w-0.5 rounded-full bg-warning-400/80" aria-hidden="true" />
                <span class="truncate normal-case tracking-normal text-sm text-white/80">{{ selectedParent?.title }}</span>
              </div>
              <ul class="mt-3 space-y-1.5 max-h-64 overflow-y-auto">
                <li
                  v-for="subtask in currentSubtasks"
                  :key="subtask.id"
                >
                  <div
                    class="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors cursor-pointer"
                    :class="timerStore.currentTaskId === subtask.id ? 'bg-white/10 ring-1 ring-success-400/40' : 'hover:bg-white/5'"
                    @click="selectTask(subtask.id, subtask.title, subtask.projectId)"
                  >
                    <button
                      role="checkbox"
                      :aria-checked="subtask.status === 'done'"
                      :aria-label="subtask.status === 'done' ? '标记为未完成' : '标记为已完成'"
                      class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                      :class="subtask.status === 'done'
                        ? 'border-success-500 bg-success-500'
                        : 'border-white/30 hover:border-white/60'"
                      @click.stop="toggleTask($event, subtask.id)"
                    >
                      <svg v-if="subtask.status === 'done'" class="h-2.5 w-2.5 text-white" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                      </svg>
                    </button>
                    <span class="min-w-0 flex-1 truncate text-sm" :class="subtask.status === 'done' ? 'text-white/35 line-through' : 'text-white/90'">
                      {{ subtask.title }}
                    </span>
                    <span
                      v-if="hasSubtasks(subtask.id)"
                      class="shrink-0 rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/60"
                    >
                      {{ getSubtaskCounts(subtask.id).done }}/{{ getSubtaskCounts(subtask.id).total }}
                    </span>
                  </div>
                </li>
                <li v-if="currentSubtasks.length === 0" class="py-4 text-center text-xs text-white/30">
                  暂无子任务
                </li>
              </ul>
            </template>
          </section>

          <!-- Today's Progress (completed tasks) -->
          <section v-if="selectedParentId === null" class="px-5 py-5">
            <div class="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white/50">
              <span class="h-3 w-0.5 rounded-full bg-primary-400/80" aria-hidden="true" />
              今日进展
            </div>
            <ul v-if="todayDoneParentTasks.length > 0 || todayInProgressParentTasks.length > 0" class="mt-3 space-y-1.5">
              <!-- 已完成 -->
              <li
                v-for="task in todayDoneParentTasks"
                :key="'done-' + task.id"
              >
                <div
                  class="group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors"
                  :class="hasSubtasks(task.id) ? 'cursor-pointer hover:bg-white/5' : ''"
                  @click="hasSubtasks(task.id) && enterSubtasks(task.id)"
                >
                  <span class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-success-500" aria-hidden="true">
                    <svg class="h-2.5 w-2.5 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                    </svg>
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span class="truncate text-sm text-white/90">{{ task.title }}</span>
                      <svg
                        v-if="hasSubtasks(task.id)"
                        class="h-3 w-3 shrink-0 text-white/25 transition-colors group-hover:text-white/60"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                    <div class="mt-1 text-[11px] text-white/45">
                      <span>任务已完成</span>
                      <template v-if="hasSubtasks(task.id)">
                        <span class="mx-1 text-white/25">&middot;</span>
                        <span>今日完成 {{ getTodaySubtaskStats(task.id).done }}/{{ getTodaySubtaskStats(task.id).total }} 个子任务</span>
                      </template>
                    </div>
                    <div
                      v-if="getTodaySubtaskStats(task.id).doneTitles.length > 0"
                      class="mt-0.5 truncate text-[11px] text-white/30"
                    >
                      已完成：{{ getTodaySubtaskStats(task.id).doneTitles.join('、') }}
                    </div>
                  </div>
                </div>
              </li>
              <!-- 进行中（部分子任务完成） -->
              <li
                v-for="task in todayInProgressParentTasks"
                :key="'progress-' + task.id"
              >
                <div
                  class="group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors cursor-pointer hover:bg-white/5"
                  @click="enterSubtasks(task.id)"
                >
                  <span class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-primary-400" aria-hidden="true">
                    <span class="h-1.5 w-1.5 rounded-full bg-primary-400" />
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span class="truncate text-sm text-white/90">{{ task.title }}</span>
                      <svg
                        class="h-3 w-3 shrink-0 text-white/25 transition-colors group-hover:text-white/60"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                    <div class="mt-1 text-[11px] text-white/45">
                      今日完成 {{ getTodaySubtaskStats(task.id).done }}/{{ getTodaySubtaskStats(task.id).total }} 个子任务
                    </div>
                    <div
                      v-if="getTodaySubtaskStats(task.id).doneTitles.length > 0"
                      class="mt-0.5 truncate text-[11px] text-white/30"
                    >
                      已完成：{{ getTodaySubtaskStats(task.id).doneTitles.join('、') }}
                    </div>
                  </div>
                </div>
              </li>
            </ul>
            <div v-else class="mt-3 py-2 text-center text-xs text-white/30">
              {{ timerStore.completedPomodoros > 0 ? `已完成 ${timerStore.completedPomodoros.toFixed(1)} 个番茄` : '今日还没有已完成的任务' }}
            </div>
          </section>
        </div>

        <!-- White Noise -->
        <section class="shrink-0 border-t border-white/5 px-5 py-4">
          <div class="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white/50">
            <span
              class="h-3 w-0.5 rounded-full transition-colors"
              :class="activeSoundId ? 'bg-indigo-400/80' : 'bg-white/20'"
              aria-hidden="true"
            />
            白噪音
            <span v-if="activeSoundId" class="ml-auto normal-case tracking-normal text-[10px] text-indigo-400/70">
              {{ SOUNDS.find(s => s.id === activeSoundId)?.label }} · 播放中
            </span>
          </div>
          <div class="mt-2.5 flex flex-wrap gap-1.5">
            <button
              class="rounded-full px-2.5 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
              :class="activeSoundId === null
                ? 'bg-white/15 text-white'
                : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70'"
              @click="selectSound(null)"
            >
              关闭
            </button>
            <button
              v-for="sound in SOUNDS"
              :key="sound.id"
              class="rounded-full px-2.5 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
              :class="activeSoundId === sound.id
                ? 'bg-indigo-500/25 text-indigo-300 ring-1 ring-indigo-400/30'
                : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70'"
              @click="selectSound(sound.id)"
            >
              {{ sound.label }}
            </button>
          </div>
          <div v-if="activeSoundId !== null" class="mt-2.5 flex items-center gap-2.5">
            <svg class="h-3 w-3 shrink-0 text-white/30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M7 9v6h4l5 5V4l-5 5H7z"/>
            </svg>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              class="sound-volume flex-1 cursor-pointer"
              :value="soundVolume"
              @input="setVolume(Number(($event.target as HTMLInputElement).value))"
            />
            <svg class="h-3.5 w-3.5 shrink-0 text-white/30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
            </svg>
          </div>
        </section>
      </div>
    </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sound-volume {
  -webkit-appearance: none;
  appearance: none;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.15);
  outline: none;
}
.sound-volume::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.75);
  cursor: pointer;
  transition: background 0.15s;
}
.sound-volume::-webkit-slider-thumb:hover {
  background: rgba(255, 255, 255, 0.95);
}

.focus-modal-enter-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.focus-modal-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.focus-modal-enter-from {
  opacity: 0;
  transform: scale(1.04);
}
.focus-modal-leave-to {
  opacity: 0;
  transform: scale(0.97);
}
</style>
