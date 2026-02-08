<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useTimerStore } from '../stores/timerStore';
import { useTaskStore } from '../stores/taskStore';

const emit = defineEmits<{
  close: []
}>();

const timerStore = useTimerStore();
const taskStore = useTaskStore();

const activeTasks = computed(() => taskStore.tasks.filter(t => t.status === 'todo'));
const selectedTaskId = ref<number | null>(timerStore.currentTaskId);

// Circle progress
const circumference = 2 * Math.PI * 140;
const strokeDashoffset = computed(() => {
  return circumference - (timerStore.progress / 100) * circumference;
});

function selectTask(taskId: number, taskTitle: string) {
  selectedTaskId.value = taskId;
  timerStore.setTask(taskId, taskTitle);
}

function clearSelectedTask() {
  selectedTaskId.value = null;
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

function handleStop() {
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
    <div class="fixed inset-0 z-50 flex">
      <!-- Main Focus Area -->
      <div class="relative flex flex-1 flex-col items-center justify-center bg-slate-900">
        <!-- Background Image -->
        <div
          class="absolute inset-0 bg-cover bg-center opacity-30"
          style="background-image: url('https://images.unsplash.com/photo-1518531933037-91b2f5f229cc?w=1920&q=80')"
        />

        <!-- Back Button -->
        <button
          class="absolute left-4 top-4 z-20 flex items-center gap-1 rounded-full bg-black/20 px-3 py-1.5 text-sm text-white/80 backdrop-blur transition-colors hover:bg-black/35 hover:text-white"
          @click="handleClose"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
          返回
        </button>

        <!-- Close Button -->
        <button
          class="absolute right-4 top-4 rounded-full p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          @click="handleClose"
        >
          <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <!-- Task Selector -->
        <div class="relative z-10 mb-8">
          <div class="flex items-center gap-3 rounded-full bg-white/10 px-4 py-2 backdrop-blur">
            <button class="flex h-5 w-5 items-center justify-center rounded-full border-2 border-white/40" />
            <input
              v-if="!timerStore.currentTaskTitle"
              type="text"
              placeholder="选择或输入任务..."
              class="w-48 bg-transparent text-sm text-white placeholder:text-white/50 focus:outline-none"
              readonly
              @click="() => {}"
            />
            <span v-else class="text-sm text-white">{{ timerStore.currentTaskTitle }}</span>
            <div v-if="timerStore.currentTaskTitle" class="flex gap-1">
              <span class="h-2 w-2 rounded-full bg-red-400" />
              <span class="h-2 w-2 rounded-full bg-red-400" />
              <span class="h-2 w-2 rounded-full bg-red-400/30" />
            </div>
            <button
              v-if="timerStore.currentTaskTitle"
              class="ml-2 text-white/60 hover:text-white"
              @click="clearSelectedTask"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Timer Circle -->
        <div class="relative z-10 mb-8">
          <svg class="h-72 w-72 -rotate-90 transform" viewBox="0 0 300 300">
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
              class="transition-all duration-1000 ease-linear"
            />
          </svg>
          <!-- Timer Display -->
          <div class="absolute inset-0 flex flex-col items-center justify-center">
            <span class="font-mono text-6xl font-light tracking-wider text-white">
              {{ timerStore.display }}
            </span>
            <span class="mt-2 text-sm text-white/60">{{ timerStore.modeLabel }}</span>
          </div>
        </div>

        <!-- Control Button -->
        <div class="relative z-10">
          <template v-if="timerStore.idle">
            <button
              class="flex items-center gap-2 rounded-full bg-white/10 px-8 py-3 text-white backdrop-blur transition-all hover:bg-white/20"
              @click="handleStart"
            >
              <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              <span>开始专注</span>
            </button>
          </template>
          <template v-else-if="timerStore.running">
            <div class="flex gap-4">
              <button
                class="flex items-center gap-2 rounded-full bg-white/10 px-6 py-3 text-white backdrop-blur transition-all hover:bg-white/20"
                @click="handlePause"
              >
                <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
                <span>暂停</span>
              </button>
              <button
                class="flex items-center gap-2 rounded-full bg-red-500/20 px-6 py-3 text-red-400 backdrop-blur transition-all hover:bg-red-500/30"
                @click="handleStop"
              >
                <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 6h12v12H6z" />
                </svg>
                <span>结束</span>
              </button>
            </div>
          </template>
          <template v-else-if="timerStore.paused">
            <div class="flex gap-4">
              <button
                class="flex items-center gap-2 rounded-full bg-green-500/20 px-6 py-3 text-green-400 backdrop-blur transition-all hover:bg-green-500/30"
                @click="handleResume"
              >
                <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                <span>继续</span>
              </button>
              <button
                class="flex items-center gap-2 rounded-full bg-red-500/20 px-6 py-3 text-red-400 backdrop-blur transition-all hover:bg-red-500/30"
                @click="handleStop"
              >
                <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 6h12v12H6z" />
                </svg>
                <span>结束</span>
              </button>
            </div>
          </template>
        </div>

        <!-- Bottom Tools -->
        <div class="absolute bottom-8 z-10 flex items-center gap-8">
          <button class="flex flex-col items-center gap-1 text-white/60 transition-colors hover:text-white">
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
            <span class="text-xs">全屏</span>
          </button>
          <button class="flex flex-col items-center gap-1 text-white/60 transition-colors hover:text-white">
            <div class="flex h-5 w-5 items-center justify-center rounded border border-current text-xs font-bold">25</div>
            <span class="text-xs">计时</span>
          </button>
          <button class="flex flex-col items-center gap-1 text-white/60 transition-colors hover:text-white">
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
            <span class="text-xs">白噪音</span>
          </button>
        </div>
      </div>

      <!-- Right Sidebar -->
      <div class="flex w-80 flex-col bg-slate-800">
        <!-- Focus Time Today -->
        <div class="border-b border-slate-700 p-4">
          <div class="flex items-center gap-2 text-sm text-emerald-400">
            <span class="h-1 w-1 rounded-full bg-emerald-400" />
            今日专注时间
          </div>
          <div class="mt-2 text-3xl font-light text-white">
            <span class="text-4xl">{{ timerStore.completedPomodoros * 25 }}</span>
            <span class="ml-1 text-lg text-white/60">分钟</span>
          </div>
        </div>

        <!-- Today Tasks -->
        <div class="flex-1 overflow-auto">
          <div class="border-b border-slate-700 p-4">
            <div class="flex items-center gap-2 text-sm text-amber-400">
              <span class="h-1 w-1 rounded-full bg-amber-400" />
              今日任务
            </div>
            <ul class="mt-3 space-y-2">
              <li
                v-for="task in activeTasks.slice(0, 5)"
                :key="task.id"
                class="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-slate-700/50"
                :class="selectedTaskId === task.id ? 'bg-slate-700' : ''"
                @click="selectTask(task.id, task.title)"
              >
                <button class="flex h-4 w-4 items-center justify-center rounded-full border border-slate-500" />
                <span class="flex-1 truncate text-sm text-white">{{ task.title }}</span>
                <div class="flex gap-0.5">
                  <span class="h-1.5 w-1.5 rounded-full bg-red-400" />
                  <span class="h-1.5 w-1.5 rounded-full bg-red-400" />
                  <span class="h-1.5 w-1.5 rounded-full bg-red-400/30" />
                </div>
              </li>
              <li v-if="activeTasks.length === 0" class="py-4 text-center text-sm text-slate-500">
                暂无待办任务
              </li>
            </ul>
          </div>

          <!-- Today's Focus Records -->
          <div class="p-4">
            <div class="flex items-center gap-2 text-sm text-blue-400">
              <span class="h-1 w-1 rounded-full bg-blue-400" />
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
