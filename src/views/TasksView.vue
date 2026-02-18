<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { useTaskStore } from '../stores/taskStore';
import { useTimerStore } from '../stores/timerStore';
import { validateTaskTitle } from '../utils/validation';
import { createRecurringRule, updateRecurringRule, deactivateRecurringRule } from '../services/commands/recurring';
import type { TaskItem, Priority } from '../types/domain';

const props = defineProps<{
  filter?: string;
  id?: string;
}>();

const route = useRoute();
const taskStore = useTaskStore();
const timerStore = useTimerStore();

const isTauri = '__TAURI_INTERNALS__' in window;
const title = ref('');
const selectedTaskId = ref<number | null>(null);
const draggingTaskId = ref<number | null>(null);
const dragOverTaskId = ref<number | null>(null);
const isTaskDragging = ref(false);
const suppressTaskClick = ref(false);
const taskListWrap = ref<HTMLElement | null>(null);
const dragPreviewIds = ref<number[] | null>(null);
const dragStartOrderIds = ref<number[] | null>(null);

let activePointerId: number | null = null;
let pointerStartX = 0;
let pointerStartY = 0;
let dragMoveRafId = 0;
let dragPreviewInsertIndex = -1;
let dragLatestClientX = 0;
let dragLatestClientY = 0;
let dragLastShiftAt = 0;

const DETAIL_MIN_WIDTH = 320;
const DETAIL_MAX_WIDTH = 560;
const calendarWeekdays = ['一', '二', '三', '四', '五', '六', '日'];

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
    return taskStore.tasks.filter(t => t.parentId === null && t.projectId === currentProjectId.value && t.status === 'todo');
  }

  switch (activeTaskFilter.value) {
    case 'today':
      return taskStore.tasks.filter(t => t.parentId === null && t.status === 'todo' && t.dueAt === getDateKeyFromToday(0));
    case 'tomorrow':
      return taskStore.tasks.filter(t => t.parentId === null && t.status === 'todo' && t.dueAt === getDateKeyFromToday(1));
    case 'week':
      return taskStore.tasks.filter(t => t.parentId === null && t.status === 'todo' && isDateInRecent7Days(t.dueAt));
    case 'all':
      return taskStore.tasks.filter(t => t.parentId === null && t.status === 'todo');
    case 'completed':
      return taskStore.tasks.filter(t => t.parentId === null && t.status === 'done');
    default:
      return taskStore.tasks.filter(t => t.parentId === null && t.status === 'todo');
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

  const doneTasks = taskStore.tasks.filter(t => t.parentId === null && t.status === 'done');
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

function formatDuration(minutes: number): { value: string; unit: string } {
  if (minutes >= 60) {
    const h = (minutes / 60).toFixed(1).replace(/\.0$/, '');
    return { value: h, unit: '小时' };
  }
  return { value: String(minutes), unit: '分钟' };
}

// Stats
const estimatedTime = computed(() => {
  const totalPomodoros = filteredTasks.value
    .filter(t => t.status === 'todo')
    .reduce((sum, task) => sum + task.pomodoroCount, 0);
  return formatDuration(totalPomodoros * 25);
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
  return formatDuration(elapsedMinutes);
});

const completedTasks = computed(() => {
  return taskStore.tasks.filter(t => t.parentId === null && t.status === 'done').length;
});

const canDragSort = computed(() => activeTaskFilter.value !== 'completed');

const displayTasks = computed(() => {
  if (!dragPreviewIds.value || !isTaskDragging.value) return filteredTasks.value;
  const visibleTaskMap = new Map(filteredTasks.value.map((task) => [task.id, task]));
  const ordered = dragPreviewIds.value
    .map((id) => visibleTaskMap.get(id))
    .filter((task): task is TaskItem => task != null);
  return ordered.length === filteredTasks.value.length ? ordered : filteredTasks.value;
});

// Selected task
const selectedTask = computed(() => {
  if (!selectedTaskId.value) return null;
  return taskStore.tasks.find(t => t.id === selectedTaskId.value) || null;
});

const undoNow = ref(Date.now());
let undoTickTimer: ReturnType<typeof setInterval> | null = null;

const pendingUndoDeletion = computed(() => taskStore.pendingUndoDeletion);
const undoRemainingSeconds = computed(() => {
  const pending = pendingUndoDeletion.value;
  if (!pending) return 0;
  const remaining = pending.expiresAt - undoNow.value;
  return Math.max(0, Math.ceil(remaining / 1000));
});

type TaskDraft = {
  title: string;
  priority: Priority;
  pomodoroCount: number;
  dueAt: string;
  projectId: number | null;
  reminderDate: string;
  reminderTime: string;
  repeatRule: string;
  repeatDays: number[];
  notes: string;
};

type DateFieldKey = 'dueAt' | 'reminderDate';

type CalendarCell = {
  dateKey: string;
  day: number;
  inCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
};

const priorityOptions: { value: Priority; label: string; color: string; activeColor: string }[] = [
  { value: 0, label: '无', color: 'text-slate-400 border-slate-200', activeColor: 'bg-slate-100 text-slate-700 border-slate-300' },
  { value: 1, label: '低', color: 'text-blue-400 border-slate-200', activeColor: 'bg-blue-50 text-blue-700 border-blue-400' },
  { value: 2, label: '中', color: 'text-amber-500 border-slate-200', activeColor: 'bg-amber-50 text-amber-700 border-amber-400' },
  { value: 3, label: '高', color: 'text-red-500 border-slate-200', activeColor: 'bg-red-50 text-red-700 border-red-400' },
];

const repeatOptions: { value: string; label: string }[] = [
  { value: '', label: '不重复' },
  { value: 'daily', label: '每天' },
  { value: 'weekdays', label: '工作日' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'custom', label: '自定义' },
];

const weekdayLabels = ['一', '二', '三', '四', '五', '六', '日'];

const taskDraft = ref<TaskDraft | null>(null);
const reminderTimeOptions = ['09:00', '12:00', '18:00', '21:00'];
const activeDatePicker = ref<DateFieldKey | null>(null);
const calendarViewYear = ref(new Date().getFullYear());
const calendarViewMonth = ref(new Date().getMonth());
const dueDatePickerWrap = ref<HTMLElement | null>(null);
const reminderDatePickerWrap = ref<HTMLElement | null>(null);
const subtaskTitle = ref('');
const MAX_SUBTASKS_PER_TASK = 50;

const hasUnsavedChanges = computed(() => {
  if (!selectedTask.value || !taskDraft.value) return false;
  return JSON.stringify(normalizeDraft(taskDraft.value)) !== JSON.stringify(normalizeTask(selectedTask.value));
});

const selectedTaskIsSubtask = computed(() => selectedTask.value?.parentId != null);

const selectedTaskSubtasks = computed(() => {
  if (!selectedTask.value) return [] as TaskItem[];
  return taskStore.tasks
    .filter(task => task.parentId === selectedTask.value!.id)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'done' ? 1 : -1;
      return a.createdAt.localeCompare(b.createdAt);
    });
});

const subtaskDoneCount = computed(() => selectedTaskSubtasks.value.filter(task => task.status === 'done').length);

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

function isTaskOverdue(task: TaskItem): boolean {
  if (!task.dueAt) return false;
  if (task.status === 'done' || task.status === 'cancelled') return false;
  return task.dueAt < getDateKeyFromToday(0);
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

function parseDateKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function formatDateInputLabel(value: string): string {
  const date = parseDateKey(value);
  if (!date) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}/${date.getFullYear()}`;
}

function buildTaskDraft(task: TaskItem): TaskDraft {
  const reminder = parseReminderTime(task.reminderTime);
  // Derive repeat info from recurring rule
  let repeatRule = '';
  let repeatDays: number[] = [];
  const rule = taskStore.getRecurringRule(task.recurringRuleId);
  if (rule) {
    repeatRule = rule.repeatType;
    if (rule.repeatDays) {
      try {
        repeatDays = JSON.parse(rule.repeatDays);
      } catch {
        repeatDays = [];
      }
    }
  }
  return {
    title: task.title,
    priority: task.priority ?? 0,
    pomodoroCount: Math.max(1, task.pomodoroCount || 1),
    dueAt: task.dueAt || '',
    projectId: task.projectId,
    reminderDate: reminder.date,
    reminderTime: reminder.time,
    repeatRule,
    repeatDays,
    notes: task.notes || ''
  };
}

function normalizeDraft(draft: TaskDraft) {
  return {
    title: draft.title.trim(),
    priority: draft.priority,
    pomodoroCount: Math.min(10, Math.max(1, Math.round(draft.pomodoroCount))),
    dueAt: draft.dueAt || '',
    projectId: draft.projectId,
    reminderDate: draft.reminderDate || '',
    reminderTime: draft.reminderTime || '09:00',
    repeatRule: draft.repeatRule || '',
    repeatDays: draft.repeatDays.slice().sort(),
    notes: draft.notes.trim()
  };
}

function normalizeTask(task: TaskItem) {
  const reminder = parseReminderTime(task.reminderTime);
  let repeatRule = '';
  let repeatDays: number[] = [];
  const rule = taskStore.getRecurringRule(task.recurringRuleId);
  if (rule) {
    repeatRule = rule.repeatType;
    if (rule.repeatDays) {
      try {
        repeatDays = JSON.parse(rule.repeatDays);
      } catch {
        repeatDays = [];
      }
    }
  }
  return {
    title: task.title.trim(),
    priority: task.priority ?? 0,
    pomodoroCount: Math.min(10, Math.max(1, Math.round(task.pomodoroCount || 1))),
    dueAt: task.dueAt || '',
    projectId: task.projectId,
    reminderDate: reminder.date,
    reminderTime: reminder.time,
    repeatRule,
    repeatDays: repeatDays.slice().sort(),
    notes: (task.notes || '').trim()
  };
}

watch(selectedTask, (task) => {
  taskDraft.value = task ? buildTaskDraft(task) : null;
  subtaskTitle.value = '';
}, { immediate: true });

watch(activeTaskFilter, () => {
  cleanupPointerDragListeners();
  resetDragState();
  isTaskDragging.value = false;
  suppressTaskClick.value = false;
});

async function submitTask(): Promise<void> {
  if (!validateTaskTitle(title.value)) return;
  try {
    await taskStore.addTask(title.value.trim(), {
      projectId: currentProjectId.value
    });
    title.value = '';
  } catch (error) {
    console.error(error);
    window.alert('创建任务失败，请重试');
  }
}

function selectTask(taskId: number): void {
  if (isTaskDragging.value || suppressTaskClick.value) return;
  closeDatePicker();
  selectedTaskId.value = taskId;
}

function closeDetail(): void {
  closeDatePicker();
  selectedTaskId.value = null;
}

function areIdOrdersEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

async function applyDragReorder(orderedIds: number[]): Promise<void> {
  if (orderedIds.length === 0) return;
  const success = await taskStore.reorderTasks(orderedIds);
  if (!success) {
    window.alert('排序失败，请重试');
  }
}

function resetDragState(): void {
  draggingTaskId.value = null;
  dragOverTaskId.value = null;
  dragPreviewIds.value = null;
  dragStartOrderIds.value = null;
  dragPreviewInsertIndex = -1;
  dragLastShiftAt = 0;
}

function cleanupPointerDragListeners(): void {
  document.removeEventListener('pointermove', handleTaskPointerMove, true);
  document.removeEventListener('pointerup', handleTaskPointerUp, true);
  document.removeEventListener('pointercancel', handleTaskPointerUp, true);
  if (dragMoveRafId) {
    cancelAnimationFrame(dragMoveRafId);
    dragMoveRafId = 0;
  }
  activePointerId = null;
}

function computePreviewOrderByPointer(clientX: number, clientY: number): void {
  if (!isTaskDragging.value || draggingTaskId.value == null || !dragPreviewIds.value) return;
  const sourceTaskId = draggingTaskId.value;
  const idsWithoutSource = dragPreviewIds.value.filter((id) => id !== sourceTaskId);

  let nextInsertIndex = dragPreviewInsertIndex;
  if (nextInsertIndex < 0 || nextInsertIndex > idsWithoutSource.length) {
    nextInsertIndex = idsWithoutSource.length;
  }
  let hoverTaskId: number | null = null;

  const hovered = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  const taskElement = hovered?.closest<HTMLElement>('[data-task-id]');
  if (taskElement) {
    const taskId = Number(taskElement.dataset.taskId ?? '');
    if (Number.isFinite(taskId) && taskId > 0 && taskId !== sourceTaskId) {
      const hoverIndex = idsWithoutSource.indexOf(taskId);
      if (hoverIndex >= 0) {
        const rect = taskElement.getBoundingClientRect();
        const beforeIndex = hoverIndex;
        const afterIndex = hoverIndex + 1;
        const beforeThreshold = rect.top + (rect.height * 0.42);
        const afterThreshold = rect.top + (rect.height * 0.58);

        if (clientY <= beforeThreshold) {
          nextInsertIndex = beforeIndex;
        } else if (clientY >= afterThreshold) {
          nextInsertIndex = afterIndex;
        } else if (nextInsertIndex < beforeIndex || nextInsertIndex > afterIndex) {
          nextInsertIndex = clientY < rect.top + (rect.height / 2) ? beforeIndex : afterIndex;
        }

        hoverTaskId = taskId;
      }
    }
  }

  dragOverTaskId.value = hoverTaskId;
  if (nextInsertIndex === dragPreviewInsertIndex) return;

  const delta = nextInsertIndex - dragPreviewInsertIndex;
  if (Math.abs(delta) > 1) {
    nextInsertIndex = dragPreviewInsertIndex + Math.sign(delta);
  }

  const nowMs = performance.now();
  if (dragLastShiftAt > 0 && nowMs - dragLastShiftAt < 70) return;
  dragLastShiftAt = nowMs;

  dragPreviewInsertIndex = nextInsertIndex;
  const nextOrder = [...idsWithoutSource];
  nextOrder.splice(nextInsertIndex, 0, sourceTaskId);
  dragPreviewIds.value = nextOrder;
}

function onTaskPointerDown(event: PointerEvent, taskId: number): void {
  if (!canDragSort.value) return;
  if (event.button !== 0) return;

  const target = event.target as HTMLElement | null;
  if (target?.closest('button, input, textarea, select, a')) return;

  draggingTaskId.value = taskId;
  dragOverTaskId.value = null;
  isTaskDragging.value = false;
  dragPreviewIds.value = null;
  dragStartOrderIds.value = filteredTasks.value.map((task) => task.id);
  dragPreviewInsertIndex = dragStartOrderIds.value.indexOf(taskId);
  dragLastShiftAt = 0;

  activePointerId = event.pointerId;
  pointerStartX = event.clientX;
  pointerStartY = event.clientY;
  dragLatestClientX = event.clientX;
  dragLatestClientY = event.clientY;

  document.addEventListener('pointermove', handleTaskPointerMove, true);
  document.addEventListener('pointerup', handleTaskPointerUp, true);
  document.addEventListener('pointercancel', handleTaskPointerUp, true);
}

function handleTaskPointerMove(event: PointerEvent): void {
  if (!canDragSort.value || activePointerId == null || event.pointerId !== activePointerId) return;
  if (draggingTaskId.value == null) return;

  const moveDistance = Math.hypot(event.clientX - pointerStartX, event.clientY - pointerStartY);
  if (!isTaskDragging.value) {
    if (moveDistance < 6) return;
    isTaskDragging.value = true;
    dragPreviewIds.value = filteredTasks.value.map((task) => task.id);
  }

  event.preventDefault();
  dragLatestClientX = event.clientX;
  dragLatestClientY = event.clientY;
  if (dragMoveRafId) return;

  dragMoveRafId = requestAnimationFrame(() => {
    dragMoveRafId = 0;
    computePreviewOrderByPointer(dragLatestClientX, dragLatestClientY);
  });
}

function handleTaskPointerUp(event: PointerEvent): void {
  if (!canDragSort.value || activePointerId == null || event.pointerId !== activePointerId) return;
  if (dragMoveRafId) {
    cancelAnimationFrame(dragMoveRafId);
    dragMoveRafId = 0;
  }
  if (isTaskDragging.value) {
    computePreviewOrderByPointer(event.clientX, event.clientY);
  }

  const moved = isTaskDragging.value;
  const sourceTaskId = draggingTaskId.value;
  const startOrder = dragStartOrderIds.value ? [...dragStartOrderIds.value] : [];
  const finalOrder = dragPreviewIds.value ? [...dragPreviewIds.value] : startOrder;

  cleanupPointerDragListeners();
  resetDragState();

  if (!moved || sourceTaskId == null) {
    isTaskDragging.value = false;
    return;
  }

  suppressTaskClick.value = true;
  void (async () => {
    if (!areIdOrdersEqual(finalOrder, startOrder)) {
      await applyDragReorder(finalOrder);
    }
  })().finally(() => {
    window.setTimeout(() => {
      isTaskDragging.value = false;
      suppressTaskClick.value = false;
    }, 0);
  });
}

async function submitSubtask(): Promise<void> {
  if (!selectedTask.value) return;
  const title = subtaskTitle.value.trim();
  if (!title) return;

  if (selectedTaskIsSubtask.value) {
    window.alert('子任务不支持继续创建子任务');
    return;
  }

  if (selectedTaskSubtasks.value.length >= MAX_SUBTASKS_PER_TASK) {
    window.alert(`每个任务最多只能添加 ${MAX_SUBTASKS_PER_TASK} 个子任务`);
    return;
  }

  try {
    await taskStore.addTask(title, {
      parentId: selectedTask.value.id,
      projectId: selectedTask.value.projectId,
      priority: selectedTask.value.priority,
      dueAt: selectedTask.value.dueAt,
      pomodoroCount: 1,
      pomodoroDuration: selectedTask.value.pomodoroDuration,
    });
    subtaskTitle.value = '';
  } catch (error) {
    console.error(error);
    window.alert('创建子任务失败，请重试');
  }
}

async function deleteSubtask(subtaskId: number): Promise<void> {
  const subtask = taskStore.tasks.find(task => task.id === subtaskId);
  if (!subtask) return;
  if (selectedTaskId.value === subtaskId) {
    selectedTaskId.value = selectedTask.value?.id ?? null;
  }
  try {
    await taskStore.removeTask(subtaskId);
  } catch (error) {
    console.error(error);
    window.alert('删除子任务失败，请重试');
  }
}

function clampPomodoro(value: number): number {
  return Math.min(10, Math.max(1, Math.round(value)));
}

const activeCalendarDate = computed(() => {
  if (!taskDraft.value || !activeDatePicker.value) return '';
  return activeDatePicker.value === 'dueAt'
    ? taskDraft.value.dueAt
    : taskDraft.value.reminderDate;
});

const calendarTitle = computed(() => `${calendarViewYear.value}年${calendarViewMonth.value + 1}月`);

const calendarCells = computed<CalendarCell[]>(() => {
  const year = calendarViewYear.value;
  const month = calendarViewMonth.value;
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInCurrentMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const todayKey = toDateInputValue(new Date());
  const selectedKey = activeCalendarDate.value;
  const cells: CalendarCell[] = [];

  for (let i = 0; i < 42; i += 1) {
    let cellYear = year;
    let cellMonth = month;
    let day = 0;
    let inCurrentMonth = true;

    if (i < startOffset) {
      day = daysInPrevMonth - startOffset + i + 1;
      cellMonth -= 1;
      inCurrentMonth = false;
      if (cellMonth < 0) {
        cellYear -= 1;
        cellMonth = 11;
      }
    } else if (i >= startOffset + daysInCurrentMonth) {
      day = i - (startOffset + daysInCurrentMonth) + 1;
      cellMonth += 1;
      inCurrentMonth = false;
      if (cellMonth > 11) {
        cellYear += 1;
        cellMonth = 0;
      }
    } else {
      day = i - startOffset + 1;
    }

    const dateKey = toDateInputValue(new Date(cellYear, cellMonth, day));
    cells.push({
      dateKey,
      day,
      inCurrentMonth,
      isToday: dateKey === todayKey,
      isSelected: dateKey === selectedKey
    });
  }

  return cells;
});

function closeDatePicker(): void {
  activeDatePicker.value = null;
}

function openDatePicker(field: DateFieldKey): void {
  if (!taskDraft.value) return;
  if (activeDatePicker.value === field) {
    closeDatePicker();
    return;
  }

  activeDatePicker.value = field;
  const current = field === 'dueAt' ? taskDraft.value.dueAt : taskDraft.value.reminderDate;
  const parsed = parseDateKey(current);
  const base = parsed || new Date();
  calendarViewYear.value = base.getFullYear();
  calendarViewMonth.value = base.getMonth();
}

function isDatePickerOpen(field: DateFieldKey): boolean {
  return activeDatePicker.value === field;
}

function shiftCalendarMonth(delta: number): void {
  const next = new Date(calendarViewYear.value, calendarViewMonth.value + delta, 1);
  calendarViewYear.value = next.getFullYear();
  calendarViewMonth.value = next.getMonth();
}

function pickDate(dateKey: string): void {
  if (!taskDraft.value || !activeDatePicker.value) return;
  if (activeDatePicker.value === 'dueAt') {
    taskDraft.value.dueAt = dateKey;
  } else {
    taskDraft.value.reminderDate = dateKey;
  }
  closeDatePicker();
}

function clearDateField(field: DateFieldKey): void {
  if (!taskDraft.value) return;
  if (field === 'dueAt') {
    taskDraft.value.dueAt = '';
  } else {
    taskDraft.value.reminderDate = '';
  }
  if (activeDatePicker.value === field) {
    closeDatePicker();
  }
}

function handleGlobalPointerDown(event: MouseEvent | TouchEvent): void {
  if (!activeDatePicker.value) return;
  const target = event.target as Node | null;
  if (!target) return;

  const root = activeDatePicker.value === 'dueAt'
    ? dueDatePickerWrap.value
    : reminderDatePickerWrap.value;

  if (root && root.contains(target)) return;
  closeDatePicker();
}

function handleGlobalKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  closeDatePicker();
}

function changePomodoro(delta: number): void {
  if (!taskDraft.value) return;
  taskDraft.value.pomodoroCount = clampPomodoro(taskDraft.value.pomodoroCount + delta);
}

function toggleRepeatDay(day: number): void {
  if (!taskDraft.value) return;
  const idx = taskDraft.value.repeatDays.indexOf(day);
  if (idx >= 0) {
    taskDraft.value.repeatDays.splice(idx, 1);
  } else {
    taskDraft.value.repeatDays.push(day);
  }
}

async function saveTaskDetail(): Promise<void> {
  if (!selectedTask.value || !taskDraft.value) return;

  const editingTaskId = selectedTask.value.id;
  const prevRuleId = selectedTask.value.recurringRuleId;
  const taskPomodoroDuration = selectedTask.value.pomodoroDuration;
  const hadRepeat = !!prevRuleId;
  const normalized = normalizeDraft(taskDraft.value);

  if (!validateTaskTitle(normalized.title)) return;
  if (normalized.repeatRule && !normalized.dueAt) {
    openDatePicker('dueAt');
    return;
  }

  const anchorDate = normalized.dueAt || toDateInputValue(new Date());
  const newRepeatType = normalized.repeatRule;
  const reminderIso = toReminderIso(normalized.reminderDate, normalized.reminderTime);
  const repeatDaysJson = normalized.repeatDays.length > 0
    ? JSON.stringify(normalized.repeatDays)
    : null;

  try {
    await taskStore.updateTask(editingTaskId, {
      title: normalized.title,
      priority: normalized.priority,
      pomodoroCount: normalized.pomodoroCount,
      dueAt: normalized.dueAt || null,
      projectId: normalized.projectId,
      reminderTime: reminderIso,
      notes: normalized.notes || null
    });

    if (isTauri) {
      if (!hadRepeat && newRepeatType) {
        const rule = await createRecurringRule({
          title: normalized.title,
          priority: normalized.priority,
          projectId: normalized.projectId,
          repeatType: newRepeatType,
          repeatDays: repeatDaysJson,
          anchorDate,
          reminderTime: reminderIso,
          notes: normalized.notes || null,
          pomodoroCount: normalized.pomodoroCount,
          pomodoroDuration: taskPomodoroDuration || 25,
        });
        taskStore.upsertRecurringRule(rule);
        await taskStore.updateTask(editingTaskId, { recurringRuleId: rule.id });
      } else if (hadRepeat && !newRepeatType) {
        if (prevRuleId) {
          await deactivateRecurringRule(prevRuleId);
          taskStore.removeRecurringRule(prevRuleId);
        }
      } else if (hadRepeat && newRepeatType && prevRuleId) {
        await updateRecurringRule({
          id: prevRuleId,
          title: normalized.title,
          priority: normalized.priority,
          projectId: normalized.projectId,
          repeatType: newRepeatType,
          repeatDays: repeatDaysJson,
          anchorDate,
          reminderTime: reminderIso,
          notes: normalized.notes || null,
          pomodoroCount: normalized.pomodoroCount,
          pomodoroDuration: taskPomodoroDuration || 25,
        });
      }
    }

    if (timerStore.currentTaskId === editingTaskId) {
      timerStore.setTask(editingTaskId, normalized.title);
    }

    closeDetail();
  } catch (error) {
    console.error(error);
    window.alert('保存任务失败，请重试');
  }
}

async function deleteSelectedTask(): Promise<void> {
  if (!selectedTask.value) return;
  const taskId = selectedTask.value.id;
  selectedTaskId.value = null;
  try {
    await taskStore.removeTask(taskId);
  } catch (error) {
    console.error(error);
    window.alert('删除任务失败，请重试');
  }
}

async function undoDeleteTask(): Promise<void> {
  const success = await taskStore.undoLastDeletion();
  if (!success) {
    window.alert('撤销失败，可能已超过可撤销时间');
  }
}

function startFocusOnTask(taskId: number, taskTitle: string): void {
  timerStore.setTask(taskId, taskTitle);
}

function getProjectName(projectId: number): string {
  const target = taskStore.projects.find(item => item.id === projectId);
  return target ? target.title : '未分类';
}

function priorityBarClass(priority: number): string {
  switch (priority) {
    case 3: return 'bg-red-500';
    case 2: return 'bg-amber-400';
    case 1: return 'bg-blue-400';
    default: return 'bg-transparent';
  }
}

function priorityCheckboxClass(priority: number): string {
  switch (priority) {
    case 3: return 'border-red-400 ring-1 ring-red-100';
    case 2: return 'border-amber-400 ring-1 ring-amber-100';
    case 1: return 'border-blue-400 ring-1 ring-blue-100';
    default: return 'border-slate-300';
  }
}

function priorityBadge(priority: number): { label: string; cls: string } | null {
  switch (priority) {
    case 3: return { label: '高', cls: 'bg-red-50 text-red-600 ring-1 ring-red-200' };
    case 2: return { label: '中', cls: 'bg-amber-50 text-amber-600 ring-1 ring-amber-200' };
    case 1: return { label: '低', cls: 'bg-blue-50 text-blue-600 ring-1 ring-blue-200' };
    default: return null;
  }
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
  if (undoTickTimer) {
    clearInterval(undoTickTimer);
    undoTickTimer = null;
  }
  document.removeEventListener('mousedown', handleGlobalPointerDown, true);
  document.removeEventListener('touchstart', handleGlobalPointerDown, true);
  document.removeEventListener('keydown', handleGlobalKeyDown);
  cleanupPointerDragListeners();
  resetDragState();
  stopResize();
});

onMounted(() => {
  undoTickTimer = window.setInterval(() => {
    undoNow.value = Date.now();
  }, 500);

  document.addEventListener('mousedown', handleGlobalPointerDown, true);
  document.addEventListener('touchstart', handleGlobalPointerDown, true);
  document.addEventListener('keydown', handleGlobalKeyDown);
});
</script>

<template>
  <div class="flex h-full min-w-0 items-stretch">
    <!-- Main Task List -->
    <div class="flex min-w-0 flex-1 flex-col">
      <!-- Header -->
      <div class="border-b border-slate-200 bg-white px-6 py-4">
        <div class="flex items-center justify-between">
          <h1 class="text-xl font-semibold text-slate-800">{{ pageTitle }}</h1>
          <button
            class="rounded p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            :class="canDragSort ? 'text-slate-400 hover:bg-slate-100 hover:text-slate-600' : 'cursor-not-allowed text-slate-300'"
            aria-label="排序"
            :title="canDragSort ? '直接拖拽任务卡片排序' : '当前视图不支持拖拽排序'"
            :disabled="!canDragSort"
          >
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4" />
            </svg>
          </button>
        </div>

        <!-- Stats Bar -->
        <div class="mt-4 grid grid-cols-4 gap-4 rounded-lg bg-slate-50 p-3">
          <div class="text-center">
            <div class="text-xl font-semibold tabular-nums text-blue-600">{{ estimatedTime.value }}<span class="text-xs text-slate-400">{{ estimatedTime.unit }}</span></div>
            <div class="text-xs text-slate-500">预计时间</div>
          </div>
          <div class="text-center">
            <div class="text-xl font-semibold tabular-nums text-blue-600">{{ tasksToComplete }}</div>
            <div class="text-xs text-slate-500">待完成任务</div>
          </div>
          <div class="text-center">
            <div class="text-xl font-semibold tabular-nums text-blue-600">{{ elapsedTime.value }}<span class="text-xs text-slate-400">{{ elapsedTime.unit }}</span></div>
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
                  class="group flex cursor-pointer overflow-hidden rounded-lg bg-white shadow-sm transition-shadow hover:shadow"
                  :class="selectedTaskId === task.id ? 'ring-2 ring-blue-400' : ''"
                  @click="selectTask(task.id)"
                >
                  <!-- Priority Bar -->
                  <div class="w-1.5 shrink-0 opacity-40" :class="priorityBarClass(task.priority)" />

                  <div class="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
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
          <div
            v-if="displayTasks.length > 0"
            ref="taskListWrap"
            class="relative"
          >
            <TransitionGroup
              name="task-sort"
              tag="div"
              class="space-y-2"
            >
              <div
                v-for="task in displayTasks"
                :key="task.id"
                :data-task-id="task.id"
                class="group flex cursor-pointer overflow-hidden rounded-lg bg-white shadow-sm"
                :class="[
                  selectedTaskId === task.id ? 'ring-2 ring-blue-400' : '',
                  isTaskDragging ? '' : 'hover:shadow',
                  canDragSort
                    ? (draggingTaskId === task.id && isTaskDragging ? 'cursor-grabbing' : 'cursor-grab active:cursor-grabbing')
                    : '',
                  draggingTaskId === task.id && isTaskDragging ? 'task-drag-origin pointer-events-none opacity-35' : '',
                  isTaskOverdue(task) ? 'border-l-2 border-l-red-500' : ''
                ]"
                @pointerdown="onTaskPointerDown($event, task.id)"
                @click="selectTask(task.id)"
              >
                <!-- Priority Bar -->
                <div
                  class="w-1.5 shrink-0 transition-colors"
                  :class="dragOverTaskId === task.id && draggingTaskId !== task.id ? 'bg-blue-500' : priorityBarClass(task.priority)"
                />

                <div class="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
                <!-- Checkbox -->
                <button
                  role="checkbox"
                  :aria-checked="task.status === 'done'"
                  :aria-label="task.status === 'done' ? '标记为未完成' : '标记为已完成'"
                  class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                  :class="task.status === 'done'
                    ? 'border-green-500 bg-green-500'
                    : priorityCheckboxClass(task.priority) + ' hover:border-red-400'"
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

                <!-- Priority Badge -->
                <span
                  v-if="priorityBadge(task.priority)"
                  class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none"
                  :class="priorityBadge(task.priority)!.cls"
                >
                  {{ priorityBadge(task.priority)!.label }}
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
                <span class="text-xs" :class="isTaskOverdue(task) ? 'font-medium text-red-600' : task.dueAt ? 'text-rose-500' : 'text-slate-400'">
                  {{ formatDueAt(task.dueAt) }}
                  <span v-if="isTaskOverdue(task)" class="ml-0.5 rounded bg-red-50 px-1 py-0.5 text-[10px] text-red-600 ring-1 ring-red-200">已逾期</span>
                </span>

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
            </TransitionGroup>

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
        class="relative h-full min-h-0 shrink-0 self-stretch border-l border-slate-200 bg-white"
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
              <!-- Priority -->
              <div class="rounded-lg border border-slate-200 p-3">
                <label class="mb-2 flex items-center gap-2 text-sm text-slate-700">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
                  </svg>
                  优先级
                </label>
                <div class="flex gap-2">
                  <button
                    v-for="opt in priorityOptions"
                    :key="opt.value"
                    class="flex-1 rounded border px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                    :class="taskDraft.priority === opt.value ? opt.activeColor : opt.color + ' hover:bg-slate-50'"
                    @click="taskDraft.priority = opt.value"
                  >
                    {{ opt.label }}
                  </button>
                </div>
              </div>

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
                  本次截止日期
                </label>
                <div class="flex items-center gap-2">
                  <div ref="dueDatePickerWrap" class="relative min-w-0 flex-1">
                    <button
                      id="task-due-at"
                      type="button"
                      class="h-10 w-full rounded border border-slate-200 px-3 text-left text-sm focus:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                      :class="taskDraft.dueAt ? 'text-slate-700' : 'text-slate-400'"
                      @click="openDatePicker('dueAt')"
                    >
                      {{ formatDateInputLabel(taskDraft.dueAt) || '选择日期' }}
                    </button>

                    <div
                      v-if="isDatePickerOpen('dueAt')"
                      class="absolute left-0 top-[calc(100%+8px)] z-50 w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-xl"
                    >
                      <div class="mb-2 flex items-center justify-between">
                        <button
                          type="button"
                          class="rounded p-1 text-slate-500 hover:bg-slate-100"
                          aria-label="上一月"
                          @click="shiftCalendarMonth(-1)"
                        >
                          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                          </svg>
                        </button>
                        <div class="text-sm font-medium text-slate-700">{{ calendarTitle }}</div>
                        <button
                          type="button"
                          class="rounded p-1 text-slate-500 hover:bg-slate-100"
                          aria-label="下一月"
                          @click="shiftCalendarMonth(1)"
                        >
                          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      </div>
                      <div class="mb-1 grid grid-cols-7 text-center text-[11px] text-slate-400">
                        <span v-for="week in calendarWeekdays" :key="week">{{ week }}</span>
                      </div>
                      <div class="grid grid-cols-7 gap-1">
                        <button
                          v-for="cell in calendarCells"
                          :key="cell.dateKey"
                          type="button"
                          class="h-8 rounded text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                          :class="cell.isSelected
                            ? 'bg-blue-600 text-white'
                            : cell.inCurrentMonth
                              ? (cell.isToday ? 'border border-blue-300 text-blue-600' : 'text-slate-700 hover:bg-slate-100')
                              : 'text-slate-300 hover:bg-slate-50'"
                          @click="pickDate(cell.dateKey)"
                        >
                          {{ cell.day }}
                        </button>
                      </div>
                    </div>
                  </div>

                  <button
                    v-if="taskDraft.dueAt"
                    class="h-10 min-w-[52px] shrink-0 rounded border border-slate-200 px-2 text-xs text-slate-500 hover:bg-slate-50"
                    @click="clearDateField('dueAt')"
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
                  class="h-10 w-full rounded border border-slate-200 px-3 text-sm text-slate-700 focus:border-blue-500 focus:outline-none"
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
                  <div ref="reminderDatePickerWrap" class="relative min-w-0 flex-1">
                    <button
                      id="task-reminder-at"
                      type="button"
                      class="h-10 w-full rounded border border-slate-200 px-3 text-left text-sm focus:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                      :class="taskDraft.reminderDate ? 'text-slate-700' : 'text-slate-400'"
                      @click="openDatePicker('reminderDate')"
                    >
                      {{ formatDateInputLabel(taskDraft.reminderDate) || '选择日期' }}
                    </button>

                    <div
                      v-if="isDatePickerOpen('reminderDate')"
                      class="absolute left-0 top-[calc(100%+8px)] z-50 w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-xl"
                    >
                      <div class="mb-2 flex items-center justify-between">
                        <button
                          type="button"
                          class="rounded p-1 text-slate-500 hover:bg-slate-100"
                          aria-label="上一月"
                          @click="shiftCalendarMonth(-1)"
                        >
                          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                          </svg>
                        </button>
                        <div class="text-sm font-medium text-slate-700">{{ calendarTitle }}</div>
                        <button
                          type="button"
                          class="rounded p-1 text-slate-500 hover:bg-slate-100"
                          aria-label="下一月"
                          @click="shiftCalendarMonth(1)"
                        >
                          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      </div>
                      <div class="mb-1 grid grid-cols-7 text-center text-[11px] text-slate-400">
                        <span v-for="week in calendarWeekdays" :key="week">{{ week }}</span>
                      </div>
                      <div class="grid grid-cols-7 gap-1">
                        <button
                          v-for="cell in calendarCells"
                          :key="cell.dateKey"
                          type="button"
                          class="h-8 rounded text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                          :class="cell.isSelected
                            ? 'bg-blue-600 text-white'
                            : cell.inCurrentMonth
                              ? (cell.isToday ? 'border border-blue-300 text-blue-600' : 'text-slate-700 hover:bg-slate-100')
                              : 'text-slate-300 hover:bg-slate-50'"
                          @click="pickDate(cell.dateKey)"
                        >
                          {{ cell.day }}
                        </button>
                      </div>
                    </div>
                  </div>

                  <select
                    v-model="taskDraft.reminderTime"
                    class="h-10 w-24 shrink-0 rounded border border-slate-200 px-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none sm:w-28"
                  >
                    <option v-for="time in reminderTimeOptions" :key="time" :value="time">{{ time }}</option>
                  </select>
                  <button
                    v-if="taskDraft.reminderDate"
                    class="h-10 min-w-[52px] shrink-0 rounded border border-slate-200 px-2 text-xs text-slate-500 hover:bg-slate-50"
                    @click="clearDateField('reminderDate')"
                  >
                    清除
                  </button>
                </div>
                <p class="mt-2 text-xs text-slate-400">当前：{{ formatReminder(toReminderIso(taskDraft.reminderDate, taskDraft.reminderTime)) }}</p>
              </div>

              <!-- Repeat -->
              <div class="rounded-lg border border-slate-200 p-3">
                <label class="mb-2 flex items-center gap-2 text-sm text-slate-700" for="task-repeat-rule">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  重复
                </label>
                <select
                  id="task-repeat-rule"
                  v-model="taskDraft.repeatRule"
                  class="h-10 w-full rounded border border-slate-200 px-3 text-sm text-slate-700 focus:border-blue-500 focus:outline-none"
                >
                  <option v-for="opt in repeatOptions" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                  </option>
                </select>
                <!-- Custom weekday toggles -->
                <div v-if="taskDraft.repeatRule === 'custom'" class="mt-2 flex gap-1">
                  <button
                    v-for="(label, idx) in weekdayLabels"
                    :key="idx"
                    class="flex h-8 w-8 items-center justify-center rounded-full border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                    :class="taskDraft.repeatDays.includes(idx + 1)
                      ? 'border-blue-500 bg-blue-500 text-white'
                      : 'border-slate-200 text-slate-500 hover:bg-slate-50'"
                    @click="toggleRepeatDay(idx + 1)"
                  >
                    {{ label }}
                  </button>
                </div>
                <p v-if="taskDraft.repeatRule && !taskDraft.dueAt" class="mt-2 text-xs text-amber-500">
                  重复任务需要先设置本次截止日期（将作为重复锚点）
                </p>
                <p v-else-if="taskDraft.repeatRule" class="mt-2 text-xs text-slate-400">
                  重复锚点：使用本次截止日期
                </p>
              </div>

              <!-- Subtasks -->
              <div class="rounded-lg border border-slate-200 p-3">
                <div class="mb-2 flex items-center justify-between">
                  <label class="flex items-center gap-2 text-sm text-slate-700">
                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5h10M9 12h10M9 19h10M4 6h.01M4 12h.01M4 18h.01" />
                    </svg>
                    子任务
                  </label>
                  <span class="text-xs text-slate-400">{{ subtaskDoneCount }}/{{ selectedTaskSubtasks.length }}</span>
                </div>

                <div v-if="selectedTaskIsSubtask" class="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  当前任务是子任务，不支持继续添加下级子任务
                </div>
                <div v-else class="mb-3 flex items-center gap-2">
                  <input
                    v-model="subtaskTitle"
                    type="text"
                    aria-label="新增子任务"
                    placeholder="添加子任务，按 Enter 保存…"
                    class="h-9 flex-1 rounded border border-slate-200 px-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
                    @keyup.enter="submitSubtask"
                  >
                  <button
                    class="h-9 shrink-0 rounded bg-slate-800 px-3 text-xs font-medium text-white transition-colors hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                    @click="submitSubtask"
                  >
                    添加
                  </button>
                </div>

                <div v-if="selectedTaskSubtasks.length > 0" class="space-y-1">
                  <div
                    v-for="subtask in selectedTaskSubtasks"
                    :key="subtask.id"
                    class="flex items-center gap-2 rounded border border-slate-200 px-2 py-1.5"
                  >
                    <button
                      role="checkbox"
                      :aria-checked="subtask.status === 'done'"
                      :aria-label="subtask.status === 'done' ? '标记为未完成' : '标记为已完成'"
                      class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                      :class="subtask.status === 'done' ? 'border-green-500 bg-green-500' : 'border-slate-300'"
                      @click="taskStore.toggleTask(subtask.id)"
                    >
                      <svg v-if="subtask.status === 'done'" class="h-2.5 w-2.5 text-white" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                      </svg>
                    </button>
                    <button
                      class="min-w-0 flex-1 truncate text-left text-sm"
                      :class="subtask.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-700'"
                      @click="selectTask(subtask.id)"
                    >
                      {{ subtask.title }}
                    </button>
                    <button
                      class="shrink-0 rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
                      @click="deleteSubtask(subtask.id)"
                    >
                      删除
                    </button>
                  </div>
                </div>
                <p v-else class="text-xs text-slate-400">暂无子任务</p>
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
                class="flex-1 rounded px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                :class="hasUnsavedChanges ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-300 cursor-not-allowed'"
                :disabled="!hasUnsavedChanges"
                @click="saveTaskDetail"
              >
                保存修改
              </button>
              <button
                class="rounded px-3 py-2 text-sm text-red-500 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
                @click="deleteSelectedTask"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      </aside>
    </Transition>

    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="translate-y-2 opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition-all duration-150 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="translate-y-2 opacity-0"
    >
      <div
        v-if="pendingUndoDeletion"
        class="pointer-events-auto fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-3 text-sm text-white shadow-xl"
      >
        <div class="flex items-center gap-3">
          <span>任务“{{ pendingUndoDeletion.taskTitle }}”已删除</span>
          <button
            class="rounded border border-white/25 px-2 py-1 text-xs font-medium text-white hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            @click="undoDeleteTask"
          >
            撤销
          </button>
          <span class="text-xs text-slate-300">{{ undoRemainingSeconds }}s</span>
        </div>
      </div>
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

.task-sort-move {
  transition: transform 300ms cubic-bezier(0.18, 0.88, 0.2, 1);
  will-change: transform;
  transform: translateZ(0);
}

.task-drag-origin {
  transform-origin: center;
  transition: opacity 220ms ease;
}
</style>
