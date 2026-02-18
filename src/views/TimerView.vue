<script setup lang="ts">
import { computed } from 'vue';
import { useTimerStore } from '../stores/timerStore';
import { useTaskStore } from '../stores/taskStore';

const timerStore = useTimerStore();
const taskStore = useTaskStore();

const activeTasks = computed(() => taskStore.tasks.filter(t => t.status === 'todo'));

const pauseDurationText = computed(() => {
  const minutes = Math.floor(timerStore.pauseDurationSeconds / 60);
  const seconds = timerStore.pauseDurationSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
});

function selectTask(taskId: number, taskTitle: string): boolean {
  const success = timerStore.setTask(taskId, taskTitle);
  if (!success) {
    window.alert('计时进行中，需先结束当前计时后再切换任务');
    return false;
  }
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
    window.alert('休息最多可延长 3 次');
  }
}

function handleStop(): void {
  const message = timerStore.mode === 'focus' ? '确定结束本次计时吗？' : '确定结束当前休息吗？';
  if (!window.confirm(message)) return;
  timerStore.stop();
}

const circumference = 2 * Math.PI * 120;
const strokeDashoffset = computed(() => {
  return circumference - (timerStore.progress / 100) * circumference;
});

const isBreakMode = computed(() => timerStore.mode !== 'focus');
const timerKindLabel = computed(() => timerStore.timerKind === 'countdown' ? '倒计时' : '正计时');
</script>

<template>
  <div class="flex h-full flex-col items-center justify-center p-8">
    <!-- Page Header -->
    <div class="mb-8 text-center">
      <h1 class="text-2xl font-bold text-slate-800">专注计时器</h1>
      <p class="mt-1 text-sm text-slate-500">保持专注，高效工作</p>
    </div>

    <!-- Timer Container -->
    <div class="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <!-- Mode Tabs -->
      <div class="mb-8 flex justify-center gap-2">
        <button
          v-for="m in (['focus', 'shortBreak', 'longBreak'] as const)"
          :key="m"
          class="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          :class="timerStore.mode === m
            ? 'bg-blue-600 text-white'
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
          :disabled="timerStore.running || timerStore.paused"
          @click="timerStore.setMode(m)"
        >
          {{ m === 'focus' ? '专注' : m === 'shortBreak' ? '短休息' : '长休息' }}
        </button>
      </div>

      <!-- Timer Kind -->
      <div v-if="timerStore.mode === 'focus'" class="mb-4 flex justify-center gap-2">
        <button
          class="rounded-lg px-4 py-2 text-xs font-medium transition-colors"
          :class="timerStore.timerKind === 'countdown'
            ? 'bg-slate-900 text-white'
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
          :disabled="!timerStore.idle"
          @click="timerStore.setTimerKind('countdown')"
        >
          倒计时
        </button>
        <button
          class="rounded-lg px-4 py-2 text-xs font-medium transition-colors"
          :class="timerStore.timerKind === 'countup'
            ? 'bg-slate-900 text-white'
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
          :disabled="!timerStore.idle"
          @click="timerStore.setTimerKind('countup')"
        >
          正计时
        </button>
      </div>

      <!-- Timer Circle -->
      <div class="relative mx-auto mb-8 h-64 w-64">
        <svg class="h-full w-full -rotate-90 transform" viewBox="0 0 256 256">
          <!-- Background circle -->
          <circle
            cx="128"
            cy="128"
            r="120"
            fill="none"
            stroke="#e2e8f0"
            stroke-width="8"
          />
          <!-- Progress circle -->
          <circle
            cx="128"
            cy="128"
            r="120"
            fill="none"
            :stroke="timerStore.mode === 'focus' ? '#2563eb' : '#10b981'"
            stroke-width="8"
            stroke-linecap="round"
            :stroke-dasharray="circumference"
            :stroke-dashoffset="strokeDashoffset"
            class="transition-all duration-1000 ease-linear"
          />
        </svg>
        <!-- Timer Display -->
        <div class="absolute inset-0 flex flex-col items-center justify-center">
          <span class="font-mono text-5xl font-bold text-slate-800">{{ timerStore.display }}</span>
          <span class="mt-2 text-sm font-medium" :class="timerStore.mode === 'focus' ? 'text-blue-600' : 'text-green-600'">
            {{ timerStore.mode === 'focus' ? timerKindLabel : timerStore.modeLabel }}
          </span>
        </div>
      </div>

      <!-- Current Task -->
      <div v-if="timerStore.currentTaskTitle" class="mb-6 rounded-lg bg-slate-50 p-3 text-center">
        <span class="text-xs text-slate-500">当前任务</span>
        <p class="mt-1 font-medium text-slate-700">{{ timerStore.currentTaskTitle }}</p>
      </div>

      <!-- Task Selection (when idle and no task) -->
      <div v-else-if="timerStore.idle && activeTasks.length > 0" class="mb-6">
        <label class="mb-2 block text-sm font-medium text-slate-600">选择任务（可选）</label>
        <select
          class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          @change="(e) => {
            const target = e.target as HTMLSelectElement;
            const task = activeTasks.find(t => t.id === Number(target.value));
            if (task) {
              const ok = selectTask(task.id, task.title);
              if (!ok) {
                target.value = timerStore.currentTaskId ? String(timerStore.currentTaskId) : '';
              }
            } else {
              target.value = '';
            }
          }"
        >
          <option value="">无关联任务</option>
          <option v-for="task in activeTasks" :key="task.id" :value="task.id">
            {{ task.title }}
          </option>
        </select>
      </div>

      <!-- Control Buttons -->
      <div class="flex justify-center gap-4">
        <!-- Idle State -->
        <template v-if="timerStore.idle">
          <button
            class="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-700"
            @click="handleStart"
          >
            <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            开始专注
          </button>
        </template>

        <!-- Running State -->
        <template v-else-if="timerStore.running">
          <button
            class="flex items-center gap-2 rounded-lg bg-amber-500 px-6 py-3 font-medium text-white transition-colors hover:bg-amber-600"
            @click="handlePause"
          >
            <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
            暂停
          </button>
          <button
            class="flex items-center gap-2 rounded-lg bg-red-500 px-6 py-3 font-medium text-white transition-colors hover:bg-red-600"
            @click="handleStop"
          >
            <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 6h12v12H6z" />
            </svg>
            {{ timerStore.mode === 'focus' ? '结束' : '结束休息' }}
          </button>
        </template>

        <!-- Paused State -->
        <template v-else-if="timerStore.paused">
          <button
            class="flex items-center gap-2 rounded-lg bg-green-600 px-6 py-3 font-medium text-white transition-colors hover:bg-green-700"
            @click="handleResume"
          >
            <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            继续
          </button>
          <button
            class="flex items-center gap-2 rounded-lg bg-red-500 px-6 py-3 font-medium text-white transition-colors hover:bg-red-600"
            @click="handleStop"
          >
            <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 6h12v12H6z" />
            </svg>
            {{ timerStore.mode === 'focus' ? '结束' : '结束休息' }}
          </button>
        </template>
      </div>

      <!-- Pause Info -->
      <div v-if="timerStore.paused" class="mt-4 space-y-1 text-center text-sm text-slate-600">
        <div>已暂停 {{ pauseDurationText }}</div>
        <div v-if="timerStore.pauseWarning" class="text-amber-600">暂停超过 30 分钟，请尽快恢复或结束</div>
      </div>

      <!-- Break Controls -->
      <div v-if="isBreakMode" class="mt-4 space-y-2">
        <div class="flex justify-center gap-4 text-sm text-slate-600">
          <button class="text-blue-600 hover:text-blue-700" @click="handleSkipBreak">跳过休息</button>
          <button
            class="text-slate-600 hover:text-slate-800 disabled:cursor-not-allowed disabled:text-slate-400"
            :disabled="timerStore.breakExtendCount >= 3"
            @click="handleExtendBreak"
          >
            延长休息 (+5 分钟) · 已用 {{ timerStore.breakExtendCount }}/3
          </button>
        </div>
      </div>

      <!-- Pomodoro Count -->
      <div class="mt-6 text-center">
        <span class="text-sm text-slate-500">
          今日已完成 <span class="font-semibold text-blue-600">{{ timerStore.completedPomodoros }}</span> 个番茄
        </span>
      </div>
    </div>
  </div>
</template>
