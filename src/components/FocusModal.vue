<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useTimerStore } from '../stores/timerStore';
import { useTaskStore } from '../stores/taskStore';
import { useUiStore } from '../stores/uiStore';
import { useFocusModal } from '../composables/useFocusModal';

const timerStore = useTimerStore();
const taskStore = useTaskStore();
const uiStore = useUiStore();
const { visible, close } = useFocusModal();

// 层级导航状态
const selectedParentId = ref<number | null>(null);

// 获取今天的日期字符串 YYYY-MM-DD
function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// 今日父任务（无父任务 + dueAt 是今天）
const todayParentTasks = computed(() => {
  const today = getTodayKey();
  return taskStore.tasks.filter(t =>
    t.status === 'todo' &&
    t.parentId === null &&
    t.dueAt === today
  );
});

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

// 检查父任务的所有直接子任务是否都已完成
function areAllSubtasksDone(parentId: number): boolean {
  const subtasks = taskStore.tasks.filter(t => t.parentId === parentId);
  if (subtasks.length === 0) return false;
  return subtasks.every(t => t.status === 'done' || t.status === 'cancelled');
}

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
const strokeDashoffset = computed(() => {
  return circumference - ((timerStore.progress ?? 0) / 100) * circumference;
});

function selectTask(taskId: number, taskTitle: string) {
  timerStore.setTask(taskId, taskTitle);
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
    case 2: return 'border-amber-400 ring-1 ring-amber-400/30';
    case 1: return 'border-blue-400 ring-1 ring-blue-400/30';
    default: return 'border-slate-500';
  }
}

async function toggleTask(e: Event, taskId: number): Promise<void> {
  e.stopPropagation();
  const result = await taskStore.toggleTask(taskId);

  // 如果子任务全部完成，提示用户是否要完成父任务
  const task = taskStore.tasks.find(t => t.id === taskId);
  if (task?.status === 'done' && task.parentId != null && areAllSubtasksDone(task.parentId)) {
    const parent = taskStore.tasks.find(t => t.id === task.parentId);
    if (parent && parent.status !== 'done') {
      const confirmed = await uiStore.confirm(
        `「${parent.title}」的所有子任务已完成，是否将父任务也标记为完成？`,
        { title: '子任务已全部完成' }
      );
      if (confirmed) {
        await taskStore.toggleTask(result.parentId!);
      }
    }
  }

  // 如果任务完成且是当前计时器关联的任务，清空计时器任务状态
  if (result.ok && result.taskId === timerStore.currentTaskId) {
    if (task?.status === 'done') {
      timerStore.clearTask();
    }
  }
}

// Handle ESC key
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    handleClose();
  }
}

watch(visible, (show) => {
  if (show) {
    document.addEventListener('keydown', handleKeydown);
  } else {
    document.removeEventListener('keydown', handleKeydown);
  }
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="focus-modal">
    <div
      v-if="visible"
      role="dialog"
      aria-modal="true"
      aria-label="专注模式"
      class="fixed inset-0 z-50 flex overscroll-contain"
    >
      <!-- Main Focus Area -->
      <div class="relative flex flex-1 flex-col items-center justify-center bg-slate-900">
        <!-- Background Gradient -->
        <div
          class="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 opacity-80"
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
              class="flex h-5 w-5 items-center justify-center rounded-full bg-green-500"
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
            <div v-if="timerStore.currentTaskTitle" class="flex gap-1" aria-hidden="true">
              <span class="h-2 w-2 rounded-full bg-red-400" />
              <span class="h-2 w-2 rounded-full bg-red-400" />
              <span class="h-2 w-2 rounded-full bg-red-400/30" />
            </div>
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
        <div class="absolute inset-0 flex flex-col items-center justify-center">
          <span class="font-mono tabular-nums tracking-wider text-white" :class="displayHasHours ? 'text-4xl' : 'text-6xl'" :style="{ fontWeight: displayHasHours ? 400 : 300 }">
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
                class="flex items-center gap-2 rounded-full bg-green-500/20 px-6 py-3 text-green-400 backdrop-blur transition-colors hover:bg-green-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400/40"
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
          <div v-if="timerStore.pauseWarning" class="text-amber-300">暂停超过 30 分钟，请尽快恢复或结束</div>
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
      <div class="flex w-80 flex-col bg-slate-800">
        <!-- Focus Time Today -->
        <div class="border-b border-slate-700 p-4">
          <div class="flex items-center gap-2 text-sm text-emerald-400">
            <span class="h-1 w-1 rounded-full bg-emerald-400" aria-hidden="true" />
            今日专注时间
          </div>
          <div class="mt-2 text-3xl font-light tabular-nums text-white">
            <span class="text-4xl">{{ focusMinutesToday }}</span>
            <span class="ml-1 text-lg text-white/60">分钟</span>
          </div>
        </div>

        <!-- Today Tasks -->
        <div class="flex-1 overflow-auto">
          <div class="border-b border-slate-700 p-4">
            <!-- 父任务视图 -->
            <template v-if="selectedParentId === null">
              <div class="flex items-center gap-2 text-sm text-amber-400">
                <span class="h-1 w-1 rounded-full bg-amber-400" aria-hidden="true" />
                今日任务
              </div>
              <ul class="mt-3 space-y-2 max-h-64 overflow-y-auto">
                <li
                  v-for="task in todayParentTasks"
                  :key="task.id"
                >
                  <div
                    class="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-slate-700/50 cursor-pointer"
                    :class="timerStore.currentTaskId === task.id ? 'bg-slate-700 ring-1 ring-emerald-500/50' : ''"
                    @click="selectTask(task.id, task.title)"
                  >
                    <!-- Checkbox: 点击完成任务 -->
                    <button
                      role="checkbox"
                      :aria-checked="task.status === 'done'"
                      :aria-label="task.status === 'done' ? '标记为未完成' : '标记为已完成'"
                      class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                      :class="task.status === 'done'
                        ? 'border-green-500 bg-green-500'
                        : priorityCheckboxClass(task.priority) + ' hover:border-red-400'"
                      @click.stop="toggleTask($event, task.id)"
                    >
                      <svg v-if="task.status === 'done'" class="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                      </svg>
                    </button>
                    <span class="min-w-0 flex-1 truncate text-sm text-white">{{ task.title }}</span>
                    <!-- 展开子任务箭头 -->
                    <button
                      v-if="hasSubtasks(task.id)"
                      class="flex h-6 w-6 items-center justify-center rounded text-white/40 hover:text-white"
                      :aria-label="`查看 ${task.title} 的子任务`"
                      @click.stop="enterSubtasks(task.id)"
                    >
                      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </li>
                <li v-if="todayParentTasks.length === 0" class="py-4 text-center text-sm text-slate-500">
                  今日暂无待办任务
                </li>
              </ul>
            </template>

            <!-- 子任务视图 -->
            <template v-else>
              <div class="flex items-center justify-between">
                <button
                  class="flex items-center gap-1 text-sm text-white/60 hover:text-white"
                  @click="goBack"
                >
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                  </svg>
                  返回
                </button>
              </div>
              <div class="mt-2 flex items-center gap-2 text-sm text-amber-400">
                <span class="h-1 w-1 rounded-full bg-amber-400" aria-hidden="true" />
                {{ selectedParent?.title }}
              </div>
              <ul class="mt-3 space-y-2 max-h-64 overflow-y-auto">
                <li
                  v-for="subtask in currentSubtasks"
                  :key="subtask.id"
                >
                  <div
                    class="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-slate-700/50"
                    :class="timerStore.currentTaskId === subtask.id ? 'bg-slate-700 ring-1 ring-emerald-500/50' : ''"
                    @click="selectTask(subtask.id, subtask.title)"
                  >
                    <!-- Checkbox: 点击完成子任务 -->
                    <button
                      role="checkbox"
                      :aria-checked="subtask.status === 'done'"
                      :aria-label="subtask.status === 'done' ? '标记为未完成' : '标记为已完成'"
                      class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                      :class="subtask.status === 'done'
                        ? 'border-green-500 bg-green-500'
                        : priorityCheckboxClass(subtask.priority) + ' hover:border-red-400'"
                      @click.stop="toggleTask($event, subtask.id)"
                    >
                      <svg v-if="subtask.status === 'done'" class="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                      </svg>
                    </button>
                    <span class="min-w-0 flex-1 truncate text-sm" :class="subtask.status === 'done' ? 'text-slate-500 line-through' : 'text-white'">
                      {{ subtask.title }}
                    </span>
                  </div>
                </li>
                <li v-if="currentSubtasks.length === 0" class="py-4 text-center text-sm text-slate-500">
                  暂无子任务
                </li>
              </ul>
            </template>
          </div>

          <!-- Today's Focus Records -->
          <div class="p-4">
            <div class="flex items-center gap-2 text-sm text-blue-400">
              <span class="h-1 w-1 rounded-full bg-blue-400" aria-hidden="true" />
              今日专注记录
            </div>
            <div class="mt-3 text-center text-sm text-slate-500">
              {{ timerStore.completedPomodoros > 0 ? `已完成 ${timerStore.completedPomodoros.toFixed(1)} 个番茄` : '开始你的第一个番茄吧' }}
            </div>
          </div>
        </div>
      </div>
    </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
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
