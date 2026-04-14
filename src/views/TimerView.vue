<script setup lang="ts">
import { computed } from 'vue';
import { useTimerStore } from '../stores/timerStore';
import { useTaskStore } from '../stores/taskStore';
import { useUiStore } from '../stores/uiStore';

const timerStore = useTimerStore();
const taskStore = useTaskStore();
const uiStore = useUiStore();

const activeTasks = computed(() => taskStore.tasks.filter(t => t.status === 'todo'));

const accent = computed(() => timerStore.mode === 'focus'
  ? {
    from: 'from-blue-500',
    to: 'to-indigo-500',
    text: 'text-blue-600',
    button: 'bg-blue-600 hover:bg-blue-700',
    chip: 'bg-blue-50 text-blue-700'
  }
  : timerStore.mode === 'shortBreak'
    ? {
      from: 'from-emerald-400',
      to: 'to-teal-500',
      text: 'text-emerald-600',
      button: 'bg-emerald-600 hover:bg-emerald-700',
      chip: 'bg-emerald-50 text-emerald-700'
    }
    : {
      from: 'from-amber-400',
      to: 'to-orange-500',
      text: 'text-amber-600',
      button: 'bg-amber-600 hover:bg-amber-700',
      chip: 'bg-amber-50 text-amber-700'
    });

const pauseDurationText = computed(() => {
  const minutes = Math.floor(timerStore.pauseDurationSeconds / 60);
  const seconds = timerStore.pauseDurationSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
});

function selectTask(taskId: number, taskTitle: string): boolean {
  timerStore.setTask(taskId, taskTitle);
  return true;
}

function handleStart(): void {
  timerStore.start();
}

function handlePause(): void {
  timerStore.pause();
}

function handleResume(): void {
  timerStore.resume();
}

function handleSkipBreak(): void {
  timerStore.skipBreak();
}

function handleExtendBreak(): void {
  const extended = timerStore.extendBreak();
  if (!extended) {
    uiStore.notify('休息最多可延长 3 次');
  }
}

async function handleStop(): Promise<void> {
  const message = timerStore.mode === 'focus' ? '确定结束本次计时吗？' : '确定结束当前休息吗？';
  const confirmed = await uiStore.confirm(message, { title: '结束计时' });
  if (!confirmed) return;
  timerStore.stop();
}

const circumference = 2 * Math.PI * 120;
const displayHasHours = computed(() => timerStore.display.includes(':') && timerStore.display.split(':').length > 2);
const strokeDashoffset = computed(() => {
  return circumference - ((timerStore.progress ?? 0) / 100) * circumference;
});

const isBreakMode = computed(() => timerStore.mode !== 'focus');
const timerKindLabel = computed(() => timerStore.timerKind === 'countdown' ? '倒计时' : '正计时');
const statusLabel = computed(() => {
  if (timerStore.running) return '计时中';
  if (timerStore.paused) return '已暂停';
  return '待开始';
});
</script>

<template>
  <div class="relative h-full w-full overflow-auto bg-slate-50">
    <div class="absolute inset-x-0 top-0 h-56 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900" />
    <div class="relative mx-auto flex max-w-6xl flex-col gap-6 px-6 pb-10 pt-8">
      <header class="flex items-center justify-between text-white">
        <div>
          <p class="text-sm uppercase tracking-[0.2em] text-white/60">Focus Station</p>
          <h1 class="mt-1 text-3xl font-semibold">专注计时器</h1>
          <p class="text-sm text-white/70">沉浸专注，轻量掌控番茄与休息节奏</p>
        </div>
        <div class="hidden items-center gap-3 rounded-full bg-white/10 px-3 py-2 text-xs text-white/80 backdrop-blur sm:flex">
          <span class="h-2 w-2 rounded-full bg-emerald-300" />
          <span>{{ statusLabel }}</span>
        </div>
      </header>

      <div class="grid gap-6 lg:grid-cols-[2fr,1fr]">
        <!-- Left: timer -->
        <div class="rounded-2xl border border-slate-100 bg-white/80 shadow-lg backdrop-blur">
          <div class="flex items-center justify-between border-b border-slate-100 px-6 py-4">
            <div class="flex items-center gap-2">
              <span class="rounded-full px-3 py-1 text-xs font-medium" :class="accent.chip">
                {{ timerStore.mode === 'focus' ? '专注' : timerStore.mode === 'shortBreak' ? '短休息' : '长休息' }}
              </span>
              <span v-if="timerStore.mode === 'focus'" class="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                {{ timerKindLabel }}
              </span>
            </div>
            <div class="flex items-center gap-2 text-xs text-slate-500">
              <span class="h-2 w-2 rounded-full bg-emerald-400" />
              <span>今日番茄 {{ timerStore.completedPomodoros.toFixed(1) }}</span>
            </div>
          </div>

          <div class="grid gap-6 px-6 py-6 lg:grid-cols-[1.2fr,0.8fr]">
            <div class="flex flex-col items-center justify-center">
              <div class="relative flex h-72 w-72 items-center justify-center">
                <div
                  class="absolute inset-0 rounded-full bg-gradient-to-br opacity-80 blur-3xl"
                  :class="`${accent.from} ${accent.to}`"
                />
                <svg class="relative z-10 h-full w-full -rotate-90 transform" viewBox="0 0 256 256">
                  <circle cx="128" cy="128" r="118" fill="none" stroke="#e2e8f0" stroke-width="10" />
                  <circle
                    v-if="timerStore.timerKind === 'countdown'"
                    cx="128"
                    cy="128"
                    r="118"
                    fill="none"
                    :stroke="timerStore.mode === 'focus' ? '#2563eb' : timerStore.mode === 'shortBreak' ? '#10b981' : '#f59e0b'"
                    stroke-width="10"
                    stroke-linecap="round"
                    :stroke-dasharray="circumference"
                    :stroke-dashoffset="strokeDashoffset"
                    class="transition-all duration-1000 ease-linear"
                  />
                </svg>
                <div class="absolute inset-0 z-20 flex flex-col items-center justify-center text-center">
                  <span class="font-mono tabular-nums text-slate-900" :class="displayHasHours ? 'text-4xl' : 'text-6xl'" :style="{ fontWeight: 600 }">{{ timerStore.display }}</span>
                  <span :class="`mt-2 text-xs font-semibold uppercase tracking-[0.2em] ${accent.text}`">
                    {{ timerStore.mode === 'focus' ? timerKindLabel : timerStore.modeLabel }}
                  </span>
                </div>
              </div>

              <div class="mt-4 flex gap-3">
                <button
                  class="rounded-full bg-slate-900 px-6 py-3 text-sm font-medium text-white shadow transition hover:bg-slate-800 disabled:opacity-50"
                  :disabled="!timerStore.idle || timerStore.timerKind === 'countdown' || timerStore.mode !== 'focus'"
                  @click="timerStore.setTimerKind('countdown')"
                >
                  倒计时
                </button>
                <button
                  class="rounded-full bg-slate-200 px-6 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-300 disabled:opacity-50"
                  :disabled="!timerStore.idle || timerStore.timerKind === 'countup' || timerStore.mode !== 'focus'"
                  @click="timerStore.setTimerKind('countup')"
                >
                  正计时
                </button>
              </div>
            </div>

            <div class="flex flex-col justify-between gap-4">
              <div class="rounded-xl bg-slate-50 px-4 py-3">
                <div class="mb-2 flex items-center justify-between">
                  <p class="text-sm font-semibold text-slate-800">计时模式</p>
                  <div class="flex gap-2 text-xs text-slate-500">
                    <button
                      v-for="m in (['focus', 'shortBreak', 'longBreak'] as const)"
                      :key="m"
                      class="rounded-full px-3 py-1 transition-colors"
                      :class="timerStore.mode === m ? accent.chip : 'bg-white text-slate-600 hover:bg-slate-100'"
                      :disabled="timerStore.running || timerStore.paused"
                      @click="timerStore.setMode(m)"
                    >
                      {{ m === 'focus' ? '专注' : m === 'shortBreak' ? '短休息' : '长休息' }}
                    </button>
                  </div>
                </div>
                <div class="text-sm text-slate-600">
                  <p v-if="timerStore.mode === 'focus'">保持专注，完成一次高质量投入</p>
                  <p v-else>放松一下，下一轮会更高效</p>
                </div>
              </div>

              <div class="rounded-xl border border-dashed border-slate-200 px-4 py-3">
                <div class="mb-2 flex items-center justify-between">
                  <p class="text-sm font-semibold text-slate-800">任务</p>
                  <div class="flex items-center gap-2">
                    <span v-if="timerStore.segmentSwitchCount > 0" class="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600">
                      已切换 {{ timerStore.segmentSwitchCount }} 次
                    </span>
                    <span v-if="timerStore.currentTaskTitle" class="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                      已关联
                    </span>
                  </div>
                </div>
                <div v-if="timerStore.currentTaskTitle" class="mb-2 text-sm font-medium text-slate-800">
                  {{ timerStore.currentTaskTitle }}
                </div>
                <div class="space-y-2">
                  <p v-if="!timerStore.currentTaskTitle" class="text-xs text-slate-500">选择一个任务并开始专注</p>
                  <select
                    class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    :value="timerStore.currentTaskId || ''"
                    @change="(e) => {
                      const target = e.target as HTMLSelectElement;
                      const task = activeTasks.find(t => t.id === Number(target.value));
                      if (task) {
                        selectTask(task.id, task.title);
                      } else {
                        timerStore.clearTask();
                      }
                    }"
                  >
                    <option value="">无关联任务</option>
                    <option v-for="task in activeTasks" :key="task.id" :value="task.id">
                      {{ task.title }}
                    </option>
                  </select>
                </div>
              </div>

              <div class="flex flex-wrap gap-3">
                <template v-if="timerStore.idle">
                  <button
                    class="flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold text-white shadow transition"
                    :class="accent.button"
                    @click="handleStart"
                  >
                    <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    开始
                  </button>
                </template>
                <template v-else-if="timerStore.running">
                  <button
                    class="flex flex-1 items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-3 text-sm font-semibold text-white shadow transition hover:bg-amber-600"
                    @click="handlePause"
                  >
                    <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                    </svg>
                    暂停
                  </button>
                  <button
                    class="flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow transition hover:bg-slate-800"
                    @click="handleStop"
                  >
                    <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 6h12v12H6z" />
                    </svg>
                    {{ timerStore.mode === 'focus' ? '结束' : '结束休息' }}
                  </button>
                </template>
                <template v-else-if="timerStore.paused">
                  <button
                    class="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-white shadow transition hover:bg-emerald-600"
                    @click="handleResume"
                  >
                    <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    继续
                  </button>
                  <button
                    class="flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow transition hover:bg-slate-800"
                    @click="handleStop"
                  >
                    <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 6h12v12H6z" />
                    </svg>
                    {{ timerStore.mode === 'focus' ? '结束' : '结束休息' }}
                  </button>
                </template>
              </div>
            </div>
          </div>
        </div>

        <!-- Right: stats -->
        <div class="flex flex-col gap-4">
          <div class="rounded-2xl border border-slate-100 bg-white/90 p-5 shadow">
            <div class="flex items-center justify-between">
              <p class="text-sm font-semibold text-slate-800">今日进度</p>
              <span class="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">番茄</span>
            </div>
            <div class="mt-3 text-3xl font-semibold text-slate-900">
              {{ timerStore.completedPomodoros.toFixed(1) }}
              <span class="text-base font-medium text-slate-500">个</span>
            </div>
            <div class="mt-2 h-2 rounded-full bg-slate-100">
              <div
                class="h-2 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all"
                :style="{ width: `${Math.min(100, timerStore.completedPomodoros * 20)}%` }"
              />
            </div>
            <p class="mt-2 text-xs text-slate-500">每 5 个番茄建议长休息一次</p>
          </div>

          <div class="rounded-2xl border border-slate-100 bg-white/90 p-5 shadow">
            <div class="flex items-center justify-between">
              <p class="text-sm font-semibold text-slate-800">关联任务</p>
              <div class="flex items-center gap-2">
                <span v-if="timerStore.segmentSwitchCount > 0" class="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600">
                  {{ timerStore.segmentSwitchCount }} 次切换
                </span>
                <span class="text-xs text-slate-500">{{ timerStore.currentTaskTitle ? '已关联' : '未关联' }}</span>
              </div>
            </div>
            <p class="mt-3 text-sm font-medium text-slate-800">
              {{ timerStore.currentTaskTitle || '选择一个任务来记录专注' }}
            </p>
            <div class="mt-4 flex flex-wrap gap-2">
              <button
                v-for="task in activeTasks.slice(0, 4)"
                :key="task.id"
                class="rounded-full px-3 py-1 text-xs transition"
                :class="timerStore.currentTaskId === task.id ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-300' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'"
                @click="selectTask(task.id, task.title)"
              >
                {{ task.title }}
              </button>
              <span v-if="activeTasks.length === 0" class="text-xs text-slate-400">暂无待办</span>
            </div>
          </div>

          <div class="rounded-2xl border border-slate-100 bg-white/90 p-5 shadow">
            <div class="flex items-center justify-between">
              <p class="text-sm font-semibold text-slate-800">状态与休息控制</p>
              <span class="text-xs text-slate-500">{{ statusLabel }}</span>
            </div>
            <div v-if="timerStore.paused" class="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-700">
              <div class="flex items-center gap-2">
                <span class="h-2 w-2 rounded-full bg-amber-500" />
                已暂停 {{ pauseDurationText }}
              </div>
              <div v-if="timerStore.pauseWarning" class="mt-1">暂停超过 30 分钟，请尽快恢复或结束</div>
            </div>
            <div v-else class="mt-3 text-xs text-slate-500">
              {{ timerStore.running ? '保持投入，完成本次计时' : '准备好后开始下一轮专注' }}
            </div>

            <div v-if="isBreakMode" class="mt-4 flex flex-wrap gap-2">
              <button
                class="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-blue-500 hover:text-blue-600"
                @click="handleSkipBreak"
              >
                跳过休息
              </button>
              <button
                class="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-emerald-500 hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="timerStore.breakExtendCount >= 3"
                @click="handleExtendBreak"
              >
                延长 +5 分钟 · {{ timerStore.breakExtendCount }}/3
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
