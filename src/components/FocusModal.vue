<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { useTimerStore } from '../stores/timerStore';
import { useTaskStore } from '../stores/taskStore';
import { useUiStore } from '../stores/uiStore';

const emit = defineEmits<{
  close: []
}>();

const timerStore = useTimerStore();
const taskStore = useTaskStore();
const uiStore = useUiStore();

const activeTasks = computed(() => taskStore.tasks.filter(t => t.status === 'todo'));
const pauseDurationText = computed(() => {
  const minutes = Math.floor(timerStore.pauseDurationSeconds / 60);
  const seconds = timerStore.pauseDurationSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
});
const currentFocusElapsedSeconds = computed(() => (
  timerStore.mode === 'focus' && (timerStore.running || timerStore.paused)
    ? (
      timerStore.timerKind === 'countdown'
        ? Math.max(0, timerStore.totalSeconds - timerStore.remainingSeconds)
        : Math.max(0, timerStore.elapsedSeconds)
    )
    : 0
));
const focusMinutesToday = computed(() =>
  Math.floor((timerStore.focusSecondsToday + currentFocusElapsedSeconds.value) / 60)
);
const isBreakMode = computed(() => timerStore.mode !== 'focus');
const timerKindLabel = computed(() => timerStore.timerKind === 'countdown' ? '倒计时' : '正计时');

// Circle progress
const circumference = 2 * Math.PI * 140;
const strokeDashoffset = computed(() => {
  return circumference - (timerStore.progress / 100) * circumference;
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
  emit('close');
}

// Handle ESC key
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    handleClose();
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div
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
            <span class="flex h-5 w-5 items-center justify-center rounded-full border-2 border-white/40" aria-hidden="true" />
            <span v-if="!timerStore.currentTaskTitle" class="w-48 text-sm text-white/50">
              从右侧任务列表中选择…
            </span>
            <span v-else class="text-sm text-white">{{ timerStore.currentTaskTitle }}</span>
            <span v-if="timerStore.segmentSwitchCount > 0" class="rounded-full bg-indigo-500/30 px-2 py-0.5 text-xs text-indigo-200">
              已切换 {{ timerStore.segmentSwitchCount }} 次
            </span>
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
          <span class="font-mono text-6xl font-light tabular-nums tracking-wider text-white">
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
            <div class="flex items-center gap-2 text-sm text-amber-400">
              <span class="h-1 w-1 rounded-full bg-amber-400" aria-hidden="true" />
              今日任务
            </div>
            <ul class="mt-3 space-y-2">
              <li
                v-for="task in activeTasks.slice(0, 5)"
                :key="task.id"
              >
                <button
                  class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-slate-700/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  :class="timerStore.currentTaskId === task.id ? 'bg-slate-700 ring-1 ring-emerald-500/50' : ''"
                  @click="selectTask(task.id, task.title)"
                >
                  <span class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-slate-500" aria-hidden="true" />
                  <span class="min-w-0 flex-1 truncate text-sm text-white">{{ task.title }}</span>

                  <span class="flex gap-0.5" aria-hidden="true">
                    <span class="h-1.5 w-1.5 rounded-full bg-red-400" />
                    <span class="h-1.5 w-1.5 rounded-full bg-red-400" />
                    <span class="h-1.5 w-1.5 rounded-full bg-red-400/30" />
                  </span>
                </button>
              </li>
              <li v-if="activeTasks.length === 0" class="py-4 text-center text-sm text-slate-500">
                暂无待办任务
              </li>
            </ul>
          </div>

          <!-- Today's Focus Records -->
          <div class="p-4">
            <div class="flex items-center gap-2 text-sm text-blue-400">
              <span class="h-1 w-1 rounded-full bg-blue-400" aria-hidden="true" />
              今日专注记录
            </div>
            <div class="mt-3 text-center text-sm text-slate-500">
              {{ timerStore.completedPomodoros > 0 ? `已完成 ${timerStore.completedPomodoros} 个番茄` : '开始你的第一个番茄吧' }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
