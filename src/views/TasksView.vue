<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { useTaskStore } from '../stores/taskStore';
import { useTimerStore } from '../stores/timerStore';
import { validateTaskTitle } from '../utils/validation';
import type { TaskItem } from '../types/domain';

const props = defineProps<{
  filter?: string;
  id?: string;
}>();

const route = useRoute();
const taskStore = useTaskStore();
const timerStore = useTimerStore();

const title = ref('');
const selectedTaskId = ref<number | null>(null);

const DETAIL_MIN_WIDTH = 320;
const DETAIL_MAX_WIDTH = 560;

const detailPanelWidth = ref(380);
const isResizing = ref(false);

let resizeStartX = 0;
let resizeStartWidth = detailPanelWidth.value;
let resizeRafId = 0;

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDateKeyFromToday(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return toDateInputValue(date);
}

function isDateInRecent7Days(value: string | null): boolean {
  if (!value) return false;
  const today = getDateKeyFromToday(0);
  const day7 = getDateKeyFromToday(6);
  return value >= today && value <= day7;
}

const activeTaskFilter = computed(() => {
  return props.filter || String(route.name || '');
});

const currentProjectId = computed(() => {
  if (route.name !== 'project') return null;
  if (props.id) return Number(props.id);

  const routeId = route.params.id;
  if (Array.isArray(routeId)) return Number(routeId[0]) || null;
  return typeof routeId === 'string' ? Number(routeId) || null : null;
});

const defaultDueDateForCreate = computed<string | null>(() => {
  if (route.name === 'project') return null;

  switch (activeTaskFilter.value) {
    case 'today':
      return getDateKeyFromToday(0);
    case 'tomorrow':
      return getDateKeyFromToday(1);
    case 'week':
      return getDateKeyFromToday(0);
    default:
      return null;
  }
});

// Page title based on filter
const pageTitle = computed(() => {
  if (route.name === 'project' && currentProjectId.value) {
    return getProjectName(currentProjectId.value);
  }

  switch (activeTaskFilter.value) {
    case 'today': return '今天';
    case 'tomorrow': return '明天';
    case 'week': return '本周';
    case 'all': return '全部';
    case 'completed': return '已完成';
    default: return '任务';
  }
});

// Filter tasks based on route
const filteredTasks = computed(() => {
  if (route.name === 'project' && currentProjectId.value) {
    return taskStore.tasks.filter(t => t.projectId === currentProjectId.value && t.status === 'todo');
  }

  switch (activeTaskFilter.value) {
    case 'today':
      return taskStore.tasks.filter(t => t.status === 'todo' && t.dueAt === getDateKeyFromToday(0));
    case 'tomorrow':
      return taskStore.tasks.filter(t => t.status === 'todo' && t.dueAt === getDateKeyFromToday(1));
    case 'week':
      return taskStore.tasks.filter(t => t.status === 'todo' && isDateInRecent7Days(t.dueAt));
    case 'all':
      return taskStore.tasks.filter(t => t.status === 'todo');
    case 'completed':
      return taskStore.tasks.filter(t => t.status === 'done');
    default:
      return taskStore.tasks.filter(t => t.status === 'todo');
  }
});

// Completed tasks grouped by date (timeline view)
interface CompletedDateGroup {
  dateKey: string;
  label: string;
  tasks: TaskItem[];
}

function formatCompletionDateLabel(dateKey: string): string {
  const today = toDateInputValue(new Date());
  const yesterday = toDateInputValue(new Date(Date.now() - 24 * 60 * 60 * 1000));

  if (dateKey === today) return '今天';
  if (dateKey === yesterday) return '昨天';

  const [year, month, day] = dateKey.split('-');
  const currentYear = new Date().getFullYear().toString();
  if (year === currentYear) {
    return `${Number(month)}月${Number(day)}日`;
  }
  return `${year}年${Number(month)}月${Number(day)}日`;
}

const completedTasksByDate = computed<CompletedDateGroup[]>(() => {
  if (activeTaskFilter.value !== 'completed') return [];

  const doneTasks = taskStore.tasks.filter(t => t.status === 'done');
  const groups = new Map<string, TaskItem[]>();

  for (const task of doneTasks) {
    const timestamp = task.completedAt || task.updatedAt || task.createdAt;
    const dateKey = toDateInputValue(new Date(timestamp));

    if (!groups.has(dateKey)) {
      groups.set(dateKey, []);
    }
    groups.get(dateKey)!.push(task);
  }

  const sortedKeys = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a));

  return sortedKeys.map(dateKey => {
    const tasks = groups.get(dateKey)!;
    tasks.sort((a, b) => {
      const timeA = a.completedAt || a.updatedAt;
      const timeB = b.completedAt || b.updatedAt;
      return timeB.localeCompare(timeA);
    });

    return {
      dateKey,
      label: formatCompletionDateLabel(dateKey),
      tasks
    };
  });
});

// Stats
const estimatedTime = computed(() => {
  const totalPomodoros = filteredTasks.value
    .filter(t => t.status === 'todo')
    .reduce((sum, task) => sum + task.pomodoroCount, 0);
  return `${totalPomodoros * 25}m`;
});

const tasksToComplete = computed(() => {
  return filteredTasks.value.filter(t => t.status === 'todo').length;
});

const elapsedTime = computed(() => {
  const currentFocusElapsedSeconds = (
    timerStore.mode === 'focus' && (timerStore.running || timerStore.paused)
  )
    ? Math.max(0, timerStore.totalSeconds - timerStore.remainingSeconds)
    : 0;

  const elapsedMinutes = (timerStore.completedPomodoros * 25) + Math.floor(currentFocusElapsedSeconds / 60);
  return `${elapsedMinutes}m`;
});

const completedTasks = computed(() => {
  return taskStore.tasks.filter(t => t.status === 'done').length;
});

// Selected task
const selectedTask = computed(() => {
  if (!selectedTaskId.value) return null;
  return taskStore.tasks.find(t => t.id === selectedTaskId.value) || null;
});

type TaskDraft = {
  title: string;
  pomodoroCount: number;
  dueAt: string;
  projectId: number | null;
  reminderDate: string;
  reminderTime: string;
  notes: string;
};

const taskDraft = ref<TaskDraft | null>(null);
const reminderTimeOptions = ['09:00', '12:00', '18:00', '21:00'];

const hasUnsavedChanges = computed(() => {
  if (!selectedTask.value || !taskDraft.value) return false;
  return JSON.stringify(normalizeDraft(taskDraft.value)) !== JSON.stringify(normalizeTask(selectedTask.value));
});

function toDateTimeInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function parseReminderTime(value: string | null): { date: string; time: string } {
  if (!value) {
    return { date: '', time: '09:00' };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { date: '', time: '09:00' };
  }

  return {
    date: toDateInputValue(date),
    time: toDateTimeInputValue(date).slice(11, 16)
  };
}

function toReminderIso(date: string, time: string): string | null {
  if (!date) return null;
  const normalizedTime = time || '09:00';
  const value = `${date}T${normalizedTime}`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function formatReminder(reminderTime: string | null): string {
  if (!reminderTime) return '无';
  const date = new Date(reminderTime);
  if (Number.isNaN(date.getTime())) return '无';
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDueAt(dueAt: string | null): string {
  if (!dueAt) return '无截止';

  const today = toDateInputValue(new Date());
  const tomorrow = toDateInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000));

  if (dueAt === today) return '今天';
  if (dueAt === tomorrow) return '明天';

  const [year, month, day] = dueAt.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

function buildTaskDraft(task: TaskItem): TaskDraft {
  const reminder = parseReminderTime(task.reminderTime);
  return {
    title: task.title,
    pomodoroCount: Math.max(1, task.pomodoroCount || 1),
    dueAt: task.dueAt || '',
    projectId: task.projectId,
    reminderDate: reminder.date,
    reminderTime: reminder.time,
    notes: task.notes || ''
  };
}

function normalizeDraft(draft: TaskDraft) {
  return {
    title: draft.title.trim(),
    pomodoroCount: Math.min(10, Math.max(1, Math.round(draft.pomodoroCount))),
    dueAt: draft.dueAt || '',
    projectId: draft.projectId,
    reminderDate: draft.reminderDate || '',
    reminderTime: draft.reminderTime || '09:00',
    notes: draft.notes.trim()
  };
}

function normalizeTask(task: TaskItem) {
  const reminder = parseReminderTime(task.reminderTime);
  return {
    title: task.title.trim(),
    pomodoroCount: Math.min(10, Math.max(1, Math.round(task.pomodoroCount || 1))),
    dueAt: task.dueAt || '',
    projectId: task.projectId,
    reminderDate: reminder.date,
    reminderTime: reminder.time,
    notes: (task.notes || '').trim()
  };
}

watch(selectedTask, (task) => {
  taskDraft.value = task ? buildTaskDraft(task) : null;
}, { immediate: true });

function submitTask(): void {
  if (!validateTaskTitle(title.value)) return;
  taskStore.addTask(title.value.trim(), {
    projectId: currentProjectId.value,
    dueAt: defaultDueDateForCreate.value
  });
  title.value = '';
}

function selectTask(taskId: number): void {
  selectedTaskId.value = selectedTaskId.value === taskId ? null : taskId;
}

function closeDetail(): void {
  selectedTaskId.value = null;
}

function clampPomodoro(value: number): number {
  return Math.min(10, Math.max(1, Math.round(value)));
}

function handleDateFieldChange(event: Event): void {
  const target = event.target as HTMLInputElement | null;
  if (!target) return;
  window.setTimeout(() => {
    target.blur();
  }, 0);
}

function changePomodoro(delta: number): void {
  if (!taskDraft.value) return;
  taskDraft.value.pomodoroCount = clampPomodoro(taskDraft.value.pomodoroCount + delta);
}

function saveTaskDetail(): void {
  if (!selectedTask.value || !taskDraft.value) return;

  const normalized = normalizeDraft(taskDraft.value);
  if (!validateTaskTitle(normalized.title)) return;

  taskStore.updateTask(selectedTask.value.id, {
    title: normalized.title,
    pomodoroCount: normalized.pomodoroCount,
    dueAt: normalized.dueAt || null,
    projectId: normalized.projectId,
    reminderTime: toReminderIso(normalized.reminderDate, normalized.reminderTime),
    notes: normalized.notes
  });

  if (timerStore.currentTaskId === selectedTask.value.id) {
    timerStore.setTask(selectedTask.value.id, normalized.title);
  }

  taskDraft.value = buildTaskDraft(selectedTask.value);
}

function startFocusOnTask(taskId: number, taskTitle: string): void {
  timerStore.setTask(taskId, taskTitle);
}

function getProjectName(projectId: number): string {
  const target = taskStore.projects.find(item => item.id === projectId);
  return target ? target.title : '未分类';
}

function handleResizeMove(event: MouseEvent): void {
  if (!isResizing.value) return;

  if (resizeRafId) return;
  resizeRafId = requestAnimationFrame(() => {
    resizeRafId = 0;
    const delta = resizeStartX - event.clientX;
    const nextWidth = resizeStartWidth + delta;
    detailPanelWidth.value = Math.min(DETAIL_MAX_WIDTH, Math.max(DETAIL_MIN_WIDTH, nextWidth));
  });
}

function stopResize(): void {
  if (!isResizing.value) return;

  if (resizeRafId) {
    cancelAnimationFrame(resizeRafId);
    resizeRafId = 0;
  }
  isResizing.value = false;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  window.removeEventListener('mousemove', handleResizeMove);
  window.removeEventListener('mouseup', stopResize);
}

function startResize(event: MouseEvent): void {
  event.preventDefault();

  isResizing.value = true;
  resizeStartX = event.clientX;
  resizeStartWidth = detailPanelWidth.value;

  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';

  window.addEventListener('mousemove', handleResizeMove);
  window.addEventListener('mouseup', stopResize);
}

onUnmounted(() => {
  stopResize();
});
</script>

<template>
  <div class="flex h-full min-w-0">
    <!-- Main Task List -->
    <div class="flex min-w-0 flex-1 flex-col">
      <!-- Header -->
      <div class="border-b border-slate-200 bg-white px-6 py-4">
        <div class="flex items-center justify-between">
          <h1 class="text-xl font-semibold text-slate-800">{{ pageTitle }}</h1>
          <button class="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40" aria-label="排序">
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4" />
            </svg>
          </button>
        </div>

        <!-- Stats Bar -->
        <div class="mt-4 grid grid-cols-4 gap-4 rounded-lg bg-slate-50 p-3">
          <div class="text-center">
            <div class="text-xl font-semibold tabular-nums text-blue-600">{{ estimatedTime.replace('m', '') }}<span class="text-xs text-slate-400">分钟</span></div>
            <div class="text-xs text-slate-500">预计时间</div>
          </div>
          <div class="text-center">
            <div class="text-xl font-semibold tabular-nums text-blue-600">{{ tasksToComplete }}</div>
            <div class="text-xs text-slate-500">待完成任务</div>
          </div>
          <div class="text-center">
            <div class="text-xl font-semibold tabular-nums text-blue-600">{{ elapsedTime.replace('m', '') }}<span class="text-xs text-slate-400">分钟</span></div>
            <div class="text-xs text-slate-500">已用时间</div>
          </div>
          <div class="text-center">
            <div class="text-xl font-semibold tabular-nums text-green-500">{{ completedTasks }}</div>
            <div class="text-xs text-slate-500">已完成任务</div>
          </div>
        </div>
      </div>

      <!-- Task Input -->
      <div class="border-b border-slate-200 bg-white px-6 py-3">
        <div class="flex items-center gap-3">
          <svg class="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          <input
            v-model="title"
            type="text"
            aria-label="新增任务"
            placeholder="添加任务，按 Enter 保存…"
            class="flex-1 text-sm text-slate-600 placeholder:text-slate-400 focus:outline-none"
            @keyup.enter="submitTask"
          />
          <button
            class="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            @click="submitTask"
          >
            提交
          </button>
        </div>
      </div>

      <!-- Task List -->
      <div class="flex-1 overflow-auto bg-slate-50 p-6">
        <!-- Completed: Date-grouped timeline -->
        <template v-if="activeTaskFilter === 'completed'">
          <div v-if="completedTasksByDate.length > 0" class="space-y-6">
            <div v-for="group in completedTasksByDate" :key="group.dateKey">
              <!-- Date Header -->
              <div class="mb-3 flex items-center gap-3">
                <div class="h-2.5 w-2.5 shrink-0 rounded-full bg-green-500" />
                <h3 class="text-sm font-semibold text-slate-600">{{ group.label }}</h3>
                <span class="text-xs text-slate-400">{{ group.tasks.length }} 项</span>
                <div class="h-px flex-1 bg-slate-200" />
              </div>
              <!-- Tasks in this date group -->
              <div class="ml-1 space-y-2 border-l-2 border-slate-200 pl-5">
                <div
                  v-for="task in group.tasks"
                  :key="task.id"
                  class="group flex cursor-pointer items-center gap-3 rounded-lg bg-white px-4 py-3 shadow-sm transition-shadow hover:shadow"
                  :class="selectedTaskId === task.id ? 'ring-2 ring-blue-400' : ''"
                  @click="selectTask(task.id)"
                >
                  <!-- Checkbox -->
                  <button
                    role="checkbox"
                    aria-checked="true"
                    aria-label="标记为未完成"
                    class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-green-500 bg-green-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                    @click.stop="taskStore.toggleTask(task.id)"
                  >
                    <svg class="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                    </svg>
                  </button>

                  <!-- Task Title -->
                  <span class="min-w-0 flex-1 truncate text-sm text-slate-400 line-through">
                    {{ task.title }}
                  </span>

                  <!-- Pomodoro Dots -->
                  <div class="flex items-center gap-1 text-xs text-slate-400">
                    <div class="flex items-center gap-0.5">
                      <span
                        v-for="dotIndex in Math.min(task.pomodoroCount || 1, 5)"
                        :key="dotIndex"
                        class="h-2 w-2 rounded-full"
                        :class="dotIndex <= (task.pomodoroCount || 1) ? 'bg-red-400' : 'bg-red-200'"
                      />
                    </div>
                    <span v-if="(task.pomodoroCount || 1) > 5">+{{ (task.pomodoroCount || 1) - 5 }}</span>
                  </div>

                  <!-- Due Date -->
                  <span class="text-xs" :class="task.dueAt ? 'text-rose-500' : 'text-slate-400'">{{ formatDueAt(task.dueAt) }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Empty State (completed) -->
          <div v-else class="flex h-full flex-col items-center justify-center">
            <div class="flex h-24 w-24 items-center justify-center rounded-full bg-green-50">
              <svg class="h-12 w-12 text-green-200" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p class="mt-4 text-slate-600">暂无已完成任务</p>
            <p class="mt-1 text-sm text-slate-400">完成的任务将按日期分组展示在这里</p>
          </div>
        </template>

        <!-- Non-completed views: flat list -->
        <template v-else>
          <div v-if="filteredTasks.length > 0" class="space-y-2">
            <div
              v-for="task in filteredTasks"
              :key="task.id"
              class="group flex cursor-pointer items-center gap-3 rounded-lg bg-white px-4 py-3 shadow-sm transition-shadow hover:shadow"
              :class="selectedTaskId === task.id ? 'ring-2 ring-blue-400' : ''"
              @click="selectTask(task.id)"
            >
              <!-- Checkbox -->
              <button
                role="checkbox"
                :aria-checked="task.status === 'done'"
                :aria-label="task.status === 'done' ? '标记为未完成' : '标记为已完成'"
                class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                :class="task.status === 'done'
                  ? 'border-green-500 bg-green-500'
                  : 'border-slate-300 hover:border-red-400'"
                @click.stop="taskStore.toggleTask(task.id)"
              >
                <svg v-if="task.status === 'done'" class="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                </svg>
              </button>

              <!-- Task Title -->
              <span
                class="min-w-0 flex-1 truncate text-sm"
                :class="task.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-700'"
              >
                {{ task.title }}
              </span>

              <!-- Pomodoro Dots -->
              <div class="flex items-center gap-1 text-xs text-slate-400">
                <div class="flex items-center gap-0.5">
                  <span
                    v-for="dotIndex in Math.min(task.pomodoroCount || 1, 5)"
                    :key="dotIndex"
                    class="h-2 w-2 rounded-full"
                    :class="dotIndex <= (task.pomodoroCount || 1) ? 'bg-red-400' : 'bg-red-200'"
                  />
                </div>
                <span v-if="(task.pomodoroCount || 1) > 5">+{{ (task.pomodoroCount || 1) - 5 }}</span>
              </div>

              <!-- Due Date -->
              <span class="text-xs" :class="task.dueAt ? 'text-rose-500' : 'text-slate-400'">{{ formatDueAt(task.dueAt) }}</span>

              <!-- Quick Focus -->
              <button
                class="rounded p-1 text-slate-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-slate-100 hover:text-slate-600 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                aria-label="设为当前专注任务"
                @click.stop="startFocusOnTask(task.id, task.title)"
              >
                <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
            </div>
          </div>

          <!-- Empty State -->
          <div v-else class="flex h-full flex-col items-center justify-center">
            <div class="flex h-24 w-24 items-center justify-center rounded-full bg-slate-100">
              <svg class="h-12 w-12 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p class="mt-4 text-slate-600">暂无任务</p>
            <p class="mt-1 text-sm text-slate-400">点击上方输入框添加新任务</p>
          </div>
        </template>
      </div>
    </div>

    <!-- Task Detail Panel -->
    <Transition
      enter-active-class="transition-[transform,opacity] duration-300 ease-out"
      enter-from-class="translate-x-4 opacity-0"
      enter-to-class="translate-x-0 opacity-100"
      leave-active-class="transition-[transform,opacity] duration-200 ease-in"
      leave-from-class="translate-x-0 opacity-100"
      leave-to-class="translate-x-4 opacity-0"
    >
      <aside
        v-if="selectedTask && taskDraft"
        class="relative shrink-0 border-l border-slate-200 bg-white"
        :style="{ width: `${detailPanelWidth}px` }"
      >
        <button
          class="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize bg-transparent transition-colors hover:bg-blue-200/40"
          aria-label="拖拽调整宽度"
          @mousedown="startResize"
        />

        <div class="flex h-full flex-col">
          <!-- Detail Header -->
          <div class="flex items-center gap-3 border-b border-slate-200 p-4">
            <button
              role="checkbox"
              :aria-checked="selectedTask.status === 'done'"
              :aria-label="selectedTask.status === 'done' ? '标记为未完成' : '标记为已完成'"
              class="flex h-5 w-5 items-center justify-center rounded-full border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
              :class="selectedTask.status === 'done' ? 'border-green-500 bg-green-500' : 'border-slate-300'"
              @click="taskStore.toggleTask(selectedTask.id)"
            >
              <svg v-if="selectedTask.status === 'done'" class="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
              </svg>
            </button>
            <input
              v-model="taskDraft.title"
              type="text"
              aria-label="任务标题"
              class="flex-1 rounded border border-slate-200 px-2 py-1 font-medium text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="任务标题…"
            >
            <button class="text-slate-400 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40" aria-label="关闭详情" @click="closeDetail">
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Detail Content -->
          <div class="flex-1 overflow-auto p-4">
            <div class="space-y-4">
              <!-- Pomodoro Quantity -->
              <div class="rounded-lg border border-slate-200 p-3">
                <label class="mb-2 flex items-center gap-2 text-sm text-slate-700" for="task-pomodoro-count">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  番茄数量
                </label>
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <button
                      class="h-8 w-8 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                      aria-label="减少番茄数量"
                      @click="changePomodoro(-1)"
                    >
                      -
                    </button>
                    <input
                      id="task-pomodoro-count"
                      v-model.number="taskDraft.pomodoroCount"
                      type="number"
                      min="1"
                      max="10"
                      class="pomodoro-input w-16 rounded border border-slate-200 px-2 py-1 text-center text-sm focus:border-blue-500 focus:outline-none"
                      @blur="taskDraft.pomodoroCount = clampPomodoro(taskDraft.pomodoroCount)"
                    >
                    <button
                      class="h-8 w-8 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                      aria-label="增加番茄数量"
                      @click="changePomodoro(1)"
                    >
                      +
                    </button>
                  </div>
                  <div class="text-sm tabular-nums text-slate-500">≈ {{ taskDraft.pomodoroCount * 25 }} 分钟</div>
                </div>
              </div>

              <!-- Due Date -->
              <div class="rounded-lg border border-slate-200 p-3">
                <label class="mb-2 flex items-center gap-2 text-sm text-slate-700" for="task-due-at">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  截止日期
                </label>
                <div class="flex items-center gap-2">
                  <input
                    id="task-due-at"
                    v-model="taskDraft.dueAt"
                    type="date"
                    class="w-full rounded border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none"
                    @change="handleDateFieldChange"
                  >
                  <button
                    v-if="taskDraft.dueAt"
                    class="rounded border border-slate-200 px-2 py-2 text-xs text-slate-500 hover:bg-slate-50"
                    @click="taskDraft.dueAt = ''"
                  >
                    清除
                  </button>
                </div>
              </div>

              <!-- Project -->
              <div class="rounded-lg border border-slate-200 p-3">
                <label class="mb-2 flex items-center gap-2 text-sm text-slate-700" for="task-project-id">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  所属清单
                </label>
                <select
                  id="task-project-id"
                  v-model="taskDraft.projectId"
                  class="w-full rounded border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none"
                >
                  <option :value="null">无</option>
                  <option v-for="project in taskStore.projects" :key="project.id" :value="project.id">
                    {{ project.title }}
                  </option>
                </select>
              </div>

              <!-- Reminder -->
              <div class="rounded-lg border border-slate-200 p-3">
                <label class="mb-2 flex items-center gap-2 text-sm text-slate-700" for="task-reminder-at">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  提醒
                </label>
                <div class="flex items-center gap-2">
                  <input
                    id="task-reminder-at"
                    v-model="taskDraft.reminderDate"
                    type="date"
                    class="w-full rounded border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none"
                    @change="handleDateFieldChange"
                  >
                  <select
                    v-model="taskDraft.reminderTime"
                    class="w-28 rounded border border-slate-200 px-2 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none"
                  >
                    <option v-for="time in reminderTimeOptions" :key="time" :value="time">{{ time }}</option>
                  </select>
                  <button
                    v-if="taskDraft.reminderDate"
                    class="rounded border border-slate-200 px-2 py-2 text-xs text-slate-500 hover:bg-slate-50"
                    @click="taskDraft.reminderDate = ''"
                  >
                    清除
                  </button>
                </div>
                <p class="mt-2 text-xs text-slate-400">当前：{{ formatReminder(toReminderIso(taskDraft.reminderDate, taskDraft.reminderTime)) }}</p>
              </div>

              <!-- Notes -->
              <div>
                <textarea
                  v-model="taskDraft.notes"
                  aria-label="备注"
                  class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  rows="4"
                  placeholder="添加备注…"
                />
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="space-y-3 border-t border-slate-200 px-4 py-3">
            <div class="flex items-center justify-between text-xs text-slate-400">
              <span>所属清单：{{ getProjectName(taskDraft.projectId || 0) }}</span>
              <span>创建于 {{ new Date(selectedTask.createdAt || selectedTask.id).toLocaleDateString() }}</span>
            </div>
            <div class="flex items-center gap-2">
              <button
                class="w-full rounded px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                :class="hasUnsavedChanges ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-300 cursor-not-allowed'"
                :disabled="!hasUnsavedChanges"
                @click="saveTaskDetail"
              >
                保存修改
              </button>
            </div>
          </div>
        </div>
      </aside>
    </Transition>
  </div>
</template>

<style scoped>
.pomodoro-input::-webkit-outer-spin-button,
.pomodoro-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.pomodoro-input[type='number'] {
  -moz-appearance: textfield;
}
</style>
