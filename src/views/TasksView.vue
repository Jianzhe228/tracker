<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, TransitionGroup } from 'vue';
import { useRoute } from 'vue-router';
import { useTaskStore } from '../stores/taskStore';
import { useTimerStore } from '../stores/timerStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useFocusModal } from '../composables/useFocusModal';
import { validateTaskTitle } from '../utils/validation';
import { createRecurringRule, updateRecurringRule, deactivateRecurringRule } from '../services/commands/recurring';
import type { TaskItem, Priority, TaskStatus } from '../types/domain';
import { extractKeywords, recordFeedback } from '../services/suggestion';
import { refreshKnownKeywords } from '../services/suggestion/keywordCache';
import { toDateKey, getDateKeyFromToday, isDateInRecent7Days } from '../utils/date';
import { useSuggestionPanel, type SidebarSuggestion } from '../composables/useSuggestionPanel';

const props = defineProps<{
  filter?: string;
  id?: string;
}>();

const route = useRoute();
const taskStore = useTaskStore();
const timerStore = useTimerStore();
const settingsStore = useSettingsStore();
const focusModal = useFocusModal();

const isTauri = '__TAURI_INTERNALS__' in window;
const title = ref('');
const newTaskDate = ref('');
const showNewTaskCalendar = ref(false);
const newTaskCalYear = ref(new Date().getFullYear());
const newTaskCalMonth = ref(new Date().getMonth());
const newTaskCalendarWrap = ref<HTMLElement | null>(null);
const selectedTaskId = ref<number | null>(null);
const draggingTaskId = ref<number | null>(null);
const dragOverTaskId = ref<number | null>(null);
const isTaskDragging = ref(false);
const suppressTaskClick = ref(false);
const taskListWrap = ref<HTMLElement | null>(null);
const taskScrollContainer = ref<HTMLElement | null>(null);
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


// Check if a task is active on a given date:
// - exact match on dueAt or startAt
// - OR the date falls within [startAt, dueAt] range (for multi-day tasks)
function isTaskActiveOnDate(task: TaskItem, dateKey: string): boolean {
  if (task.dueAt === dateKey || task.startAt === dateKey) return true;
  if (task.startAt && task.dueAt && task.startAt <= dateKey && dateKey <= task.dueAt) return true;
  return false;
}

// Check if a task is active on any date within a range [fromKey, toKey]
function isTaskActiveInRange(task: TaskItem, fromKey: string, toKey: string): boolean {
  // Exact date falls within range
  if (task.dueAt && task.dueAt >= fromKey && task.dueAt <= toKey) return true;
  if (task.startAt && task.startAt >= fromKey && task.startAt <= toKey) return true;
  // Task spans across the range: startAt before range and dueAt after range start
  if (task.startAt && task.dueAt && task.startAt <= toKey && task.dueAt >= fromKey) return true;
  return false;
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
    case 'all': return '全部';
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
      return taskStore.tasks.filter(t => t.parentId === null && t.status === 'todo' && isTaskActiveOnDate(t, getDateKeyFromToday(0)));
    case 'all':
      return taskStore.tasks.filter(t => t.parentId === null && (t.status !== 'cancelled' || t.rescheduledTo != null));
    default:
      return taskStore.tasks.filter(t => t.parentId === null && t.status === 'todo');
  }
});

const NO_DATE_GROUP_KEY = '__no_date__';

function toDateKeyFromTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return toDateKey(new Date());
  return toDateKey(date);
}

function getTimelineDateKey(task: TaskItem): string {
  if (task.status === 'done') {
    return toDateKeyFromTimestamp(task.completedAt || task.updatedAt || task.createdAt);
  }
  if (task.startAt) return task.startAt;
  if (task.dueAt) return task.dueAt;
  return NO_DATE_GROUP_KEY;
}

function formatTimelineDateLabel(dateKey: string): string {
  if (dateKey === NO_DATE_GROUP_KEY) return '无日期';

  const today = toDateKey(new Date());
  const yesterday = toDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const tomorrow = toDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));

  if (dateKey === today) return '今天';
  if (dateKey === yesterday) return '昨天';
  if (dateKey === tomorrow) return '明天';

  const [year, month, day] = dateKey.split('-');
  const currentYear = new Date().getFullYear().toString();
  if (year === currentYear) {
    return `${Number(month)}月${Number(day)}日`;
  }
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function formatRescheduledDate(dateKey: string): string {
  const today = toDateKey(new Date());
  if (dateKey === today) return '今天';
  const [, month, day] = dateKey.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

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
  return formatDuration(totalPomodoros * settingsStore.timer.focusMinutes);
});

const tasksToComplete = computed(() => {
  return filteredTasks.value.filter(t => t.status === 'todo').length;
});

const elapsedTime = computed(() => {
  const elapsedMinutes = Math.floor((timerStore.focusSecondsToday + timerStore.currentSegmentFocusSeconds) / 60);
  return formatDuration(elapsedMinutes);
});

const completedTasks = computed(() => taskStore.statusCounts.rootDone);

const canDragSort = computed(() => activeTaskFilter.value !== 'all');

function compareTimelineDateKey(a: string, b: string): number {
  if (a === b) return 0;
  if (a === NO_DATE_GROUP_KEY) return 1;
  if (b === NO_DATE_GROUP_KEY) return -1;
  return b.localeCompare(a);
}

const displayTasks = computed(() => {
  if (activeTaskFilter.value === 'all') {
    // 'all' 视图分两段：working set 部分按 timeline date key 排序（产生
    // 今天/昨天/前天 的分组），archive 部分按后端返回顺序（已经是 completed_at
    // DESC, id DESC）追加。两段在 timeline 排序方向上同向，拼起来还是降序。
    //
    // 这样设计让 loadMoreArchive 仅追加 archive 段，working set 段引用不变，
    // Vue 不会 diff 那一段；archive 段也只是末尾追加，diff 是局部的。toggleTask
    // 把单个 working set 任务标 done 时也只移动一行。
    const all = filteredTasks.value;
    const archiveSet = taskStore.archiveOnlyIds;
    const workingPart: TaskItem[] = [];
    const archivePart: TaskItem[] = [];
    for (const task of all) {
      if (archiveSet.has(task.id)) archivePart.push(task);
      else workingPart.push(task);
    }
    workingPart.sort((a, b) => {
      const dateCmp = compareTimelineDateKey(getTimelineDateKey(a), getTimelineDateKey(b));
      if (dateCmp !== 0) return dateCmp;
      if (a.status !== b.status) return a.status === 'done' ? 1 : -1;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.createdAt.localeCompare(b.createdAt);
    });
    return [...workingPart, ...archivePart];
  }

  if (!dragPreviewIds.value || !isTaskDragging.value) return filteredTasks.value;
  const visibleTaskMap = new Map(filteredTasks.value.map((task) => [task.id, task]));
  const ordered = dragPreviewIds.value
    .map((id) => visibleTaskMap.get(id))
    .filter((task): task is TaskItem => task != null);
  return ordered.length === filteredTasks.value.length ? ordered : filteredTasks.value;
});

const timelineGroupCounts = computed(() => {
  const map = new Map<string, number>();
  if (activeTaskFilter.value !== 'all') return map;
  for (const task of displayTasks.value) {
    const dateKey = getTimelineDateKey(task);
    map.set(dateKey, (map.get(dateKey) || 0) + 1);
  }
  return map;
});

// ── Collapsible date groups ──────────────────────────────────────
const groupCollapseState = ref(new Map<string, boolean>());

function isGroupCollapsed(dateKey: string): boolean {
  const explicit = groupCollapseState.value.get(dateKey);
  if (explicit !== undefined) return explicit;
  if (dateKey === NO_DATE_GROUP_KEY) return false;
  const today = getDateKeyFromToday(0);
  const yesterday = getDateKeyFromToday(-1);
  const tomorrow = getDateKeyFromToday(1);
  return dateKey !== today && dateKey !== yesterday && dateKey !== tomorrow;
}

function toggleGroupCollapse(dateKey: string): void {
  const current = isGroupCollapsed(dateKey);
  groupCollapseState.value.set(dateKey, !current);
}

function isTaskInCollapsedGroup(task: TaskItem): boolean {
  if (activeTaskFilter.value !== 'all') return false;
  return isGroupCollapsed(getTimelineDateKey(task));
}

function shouldRenderTimelineHeader(taskIndex: number): boolean {
  if (activeTaskFilter.value !== 'all') return false;
  if (taskIndex === 0) return true;
  const current = displayTasks.value[taskIndex];
  const previous = displayTasks.value[taskIndex - 1];
  if (!current || !previous) return false;
  return getTimelineDateKey(current) !== getTimelineDateKey(previous);
}

function getTimelineHeaderLabel(task: TaskItem): string {
  return formatTimelineDateLabel(getTimelineDateKey(task));
}

function getTimelineHeaderCount(task: TaskItem): number {
  return timelineGroupCounts.value.get(getTimelineDateKey(task)) || 0;
}

function isTimelineGroupOverdue(task: TaskItem): boolean {
  const dateKey = getTimelineDateKey(task);
  if (dateKey === NO_DATE_GROUP_KEY) return false;
  return dateKey < getDateKeyFromToday(0);
}

function getTaskIdsInGroup(task: TaskItem): number[] {
  const dateKey = getTimelineDateKey(task);
  return displayTasks.value
    .filter((t) => getTimelineDateKey(t) === dateKey && t.status !== 'cancelled')
    .map((t) => t.id);
}

async function copyGroupToToday(task: TaskItem): Promise<void> {
  try {
    const ids = getTaskIdsInGroup(task);
    if (ids.length > 0) {
      await taskStore.copyTasksToToday(ids);
    }
  } catch (error) {
    console.error('Failed to copy tasks to today:', error);
    alert('复制任务失败，请稍后重试');
  }
}

async function copySingleTaskToToday(taskId: number): Promise<void> {
  try {
    await taskStore.copyTaskToToday(taskId);
  } catch (error) {
    console.error('Failed to copy task to today:', error);
    alert('复制任务失败，请稍后重试');
  }
}

const subtasksByParent = computed(() => {
  const map = new Map<number, TaskItem[]>();
  for (const task of taskStore.tasks) {
    if (task.parentId == null) continue;
    const siblings = map.get(task.parentId) || [];
    siblings.push(task);
    map.set(task.parentId, siblings);
  }

  for (const [, siblings] of map) {
    siblings.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'done' ? 1 : -1;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.createdAt.localeCompare(b.createdAt);
    });
  }

  return map;
});

function getTaskSubtasks(parentId: number): TaskItem[] {
  return subtasksByParent.value.get(parentId) || [];
}

function hasTaskSubtasks(parentId: number): boolean {
  return getTaskSubtasks(parentId).length > 0;
}

function getTaskSubtaskDoneCount(parentId: number): number {
  return getTaskSubtasks(parentId).filter((subtask) => subtask.status === 'done').length;
}

// Selected task
const selectedTask = computed(() => {
  if (!selectedTaskId.value) return null;
  return taskStore.tasks.find(t => t.id === selectedTaskId.value) || null;
});

const undoNow = ref(Date.now());
let undoTickTimer: ReturnType<typeof setInterval> | null = null;
let inlineNoticeTimer: ReturnType<typeof setTimeout> | null = null;

const pendingUndoDeletion = computed(() => taskStore.pendingUndoDeletion);
const undoRemainingSeconds = computed(() => {
  const pending = pendingUndoDeletion.value;
  if (!pending) return 0;
  const remaining = pending.expiresAt - undoNow.value;
  return Math.max(0, Math.ceil(remaining / 1000));
});

const inlineNoticeMessage = ref<string | null>(null);
const inlineNoticeToken = ref(0);
const inlineConfirmState = ref<{ message: string; resolve: (value: boolean) => void } | null>(null);

function showInlineNotice(message: string): void {
  if (inlineNoticeTimer) {
    clearTimeout(inlineNoticeTimer);
    inlineNoticeTimer = null;
  }
  inlineNoticeToken.value += 1;
  inlineNoticeMessage.value = message;
  inlineNoticeTimer = window.setTimeout(() => {
    inlineNoticeMessage.value = null;
    inlineNoticeTimer = null;
  }, 2600);
}

function requestInlineConfirm(message: string): Promise<boolean> {
  if (inlineConfirmState.value) {
    inlineConfirmState.value.resolve(false);
  }
  return new Promise((resolve) => {
    inlineConfirmState.value = {
      message,
      resolve,
    };
  });
}

function resolveInlineConfirm(confirmed: boolean): void {
  const state = inlineConfirmState.value;
  if (!state) return;
  inlineConfirmState.value = null;
  state.resolve(confirmed);
}

type TaskDraft = {
  title: string;
  priority: Priority;
  pomodoroCount: number;
  dueAt: string;
  startAt: string;
  projectId: number | null;
  reminderDate: string;
  reminderTime: string;
  repeatRule: string;
  repeatDays: number[];
  notes: string;
};

type DateFieldKey = 'dueAt' | 'startAt' | 'reminderDate';

type CalendarCell = {
  dateKey: string;
  day: number;
  inCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
};

const priorityOptions: { value: Priority; label: string; color: string; activeColor: string }[] = [
  { value: 0, label: '无', color: 'text-[#9E9E9A] border-surface-border', activeColor: 'bg-surface-hover text-[#1C1C1A] border-surface-border-hover' },
  { value: 1, label: '低', color: 'text-primary-400 border-surface-border', activeColor: 'bg-primary-50 text-primary-700 border-primary-400' },
  { value: 2, label: '中', color: 'text-warning-500 border-surface-border', activeColor: 'bg-warning-50 text-warning-700 border-warning-400' },
  { value: 3, label: '高', color: 'text-danger-400 border-surface-border', activeColor: 'bg-danger-50 text-danger-600 border-danger-400' },
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
const startDatePickerWrap = ref<HTMLElement | null>(null);
const reminderDatePickerWrap = ref<HTMLElement | null>(null);
const subtaskTitle = ref('');
const MAX_SUBTASKS_PER_TASK = 50;
const MAX_TASK_DEPTH = 10;

// ── Suggestion panel (composable) ──────────────────────────────────
const {
  panels: suggestionPanels,
  getPanel: getSuggestionPanel,
  requestSuggestions,
  acceptSuggestion: panelAcceptSuggestion,
  rejectSuggestion: panelRejectSuggestion,
  acceptAll: panelAcceptAll,
  dismissPanel,
  toggleCollapsed: toggleSuggestionCollapsed,
  clearAllPanels,
} = useSuggestionPanel();

const currentSuggestionPanel = computed(() => {
  if (!selectedTask.value) return undefined;
  return getSuggestionPanel(selectedTask.value.id);
});

function getTaskDepth(taskId: number): number {
  let depth = 0;
  let current = taskStore.tasks.find(t => t.id === taskId);
  while (current?.parentId != null) {
    depth++;
    current = taskStore.tasks.find(t => t.id === current!.parentId);
  }
  return depth;
}

const selectedTaskDepth = computed(() => {
  if (!selectedTask.value) return 0;
  return getTaskDepth(selectedTask.value.id);
});

const canAddSubtaskToSelected = computed(() => selectedTaskDepth.value < MAX_TASK_DEPTH - 1);

const hasUnsavedChanges = computed(() => {
  if (!selectedTask.value || !taskDraft.value) return false;
  return JSON.stringify(normalizeDraft(taskDraft.value)) !== JSON.stringify(normalizeTask(selectedTask.value));
});

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
    date: toDateKey(date),
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

/**
 * Check if a task can be copied to today.
 * Returns true for any past task (including completed ones).
 */
function canCopyTaskToToday(task: TaskItem): boolean {
  if (task.status === 'cancelled') return false;
  const dateKey = getTimelineDateKey(task);
  if (dateKey === NO_DATE_GROUP_KEY) return false;
  return dateKey < getDateKeyFromToday(0);
}

function formatDueAt(dueAt: string | null): string {
  if (!dueAt) return '无截止';

  const today = toDateKey(new Date());
  const tomorrow = toDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));

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
    startAt: task.startAt || '',
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
    startAt: draft.startAt || '',
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
    startAt: task.startAt || '',
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
  const taskTitle = title.value.trim();
  if (!validateTaskTitle(taskTitle)) return;

  // Due date priority: explicit date picker > view-inferred > null
  let dueAt: string | null = null;
  if (newTaskDate.value) {
    dueAt = newTaskDate.value;
  } else if (activeTaskFilter.value === 'today') {
    dueAt = getDateKeyFromToday(0);
  }

  try {
    const projectId = currentProjectId.value ?? 1; // Default to 收集箱
    const createdTask = await taskStore.addTask(taskTitle, {
      projectId,
      dueAt,
      skipHistoryAutofill: true,
    });

    title.value = '';
    newTaskDate.value = '';
    showNewTaskCalendar.value = false;

    selectedTaskId.value = createdTask.id;
    requestSuggestions(createdTask.id, createdTask.title, projectId);
  } catch (error) {
    console.error(error);
    showInlineNotice('创建任务失败，请重试');
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
  const success = await taskStore.reorderTasks(orderedIds, { parentId: null, status: 'todo' });
  if (!success) {
    showInlineNotice('排序失败，请重试');
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

async function handleToggleTask(taskId: number): Promise<void> {
  const result = await taskStore.toggleTask(taskId);
  if (!result.ok) {
    if (result.reason === 'has_incomplete_subtasks') {
      showInlineNotice('请先完成所有子任务，再完成父任务');
    } else if (result.reason === 'sync_failed') {
      showInlineNotice('更新任务状态失败，请重试');
    }
    return;
  }

  if (!result.shouldPromptCompleteParent || result.parentId == null) {
    return;
  }

  const parentTask = taskStore.tasks.find((task) => task.id === result.parentId);
  if (!parentTask || parentTask.status === 'done') return;

  const shouldCompleteParent = await requestInlineConfirm(`子任务已全部完成，是否同时完成父任务「${parentTask.title}」？`);
  if (!shouldCompleteParent) return;

  const parentResult = await taskStore.toggleTask(parentTask.id);
  if (!parentResult.ok) {
    if (parentResult.reason === 'has_incomplete_subtasks') {
      showInlineNotice('父任务仍有未完成子任务，请检查后再试');
    } else if (parentResult.reason === 'sync_failed') {
      showInlineNotice('更新父任务状态失败，请重试');
    }
  }
}

async function submitSubtask(): Promise<void> {
  if (!selectedTask.value) return;
  const title = subtaskTitle.value.trim();
  if (!title) return;

  if (!canAddSubtaskToSelected.value) {
    showInlineNotice('已达最大嵌套层级，无法继续添加子任务');
    return;
  }

  if (selectedTaskSubtasks.value.length >= MAX_SUBTASKS_PER_TASK) {
    showInlineNotice(`每个任务最多只能添加 ${MAX_SUBTASKS_PER_TASK} 个子任务`);
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

    // Record manual subtask creation as learning feedback (strongest signal)
    const parentTitle = selectedTask.value.title;
    const projectId = selectedTask.value.projectId;
    const keywords = extractKeywords(parentTitle);
    if (keywords.length > 0) {
      recordFeedback(keywords, title, projectId, true, 'manual');
      refreshKnownKeywords().catch((e) => console.warn('[tasks] failed to refresh keywords', e));
    }
  } catch (error) {
    console.error(error);
    showInlineNotice('创建子任务失败，请重试');
  }
}

// ── Suggestion panel actions (delegated to composable) ─────────────

async function handleAcceptSuggestion(suggestion: { title: string; source: string; patternName?: string }): Promise<void> {
  if (!selectedTask.value) return;
  await panelAcceptSuggestion(selectedTask.value.id, suggestion as SidebarSuggestion);
}

function handleRejectSuggestion(suggestion: { title: string; source: string; patternName?: string }): void {
  if (!selectedTask.value) return;
  panelRejectSuggestion(selectedTask.value.id, suggestion as SidebarSuggestion);
}

async function handleAcceptAllSuggestions(): Promise<void> {
  if (!selectedTask.value) return;
  await panelAcceptAll(selectedTask.value.id);
}

function handleDismissSuggestions(): void {
  if (!selectedTask.value) return;
  dismissPanel(selectedTask.value.id);
}

function handleRequestSuggestions(): void {
  if (!selectedTask.value) return;
  requestSuggestions(selectedTask.value.id, selectedTask.value.title, selectedTask.value.projectId);
}

async function deleteSubtask(subtaskId: number): Promise<void> {
  const subtask = taskStore.tasks.find(task => task.id === subtaskId);
  if (!subtask) return;
  if (selectedTaskId.value === subtaskId) {
    selectedTaskId.value = selectedTask.value?.id ?? null;
  }

  const removedIds = new Set<number>([subtaskId]);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const task of taskStore.tasks) {
      if (task.parentId != null && removedIds.has(task.parentId) && !removedIds.has(task.id)) {
        removedIds.add(task.id);
        expanded = true;
      }
    }
  }

  try {
    await taskStore.removeTask(subtaskId);
    if (timerStore.currentTaskId != null && removedIds.has(timerStore.currentTaskId)) {
      timerStore.clearTask();
    }
  } catch (error) {
    console.error(error);
    showInlineNotice('删除子任务失败，请重试');
  }
}

function clampPomodoro(value: number): number {
  return Math.min(10, Math.max(1, Math.round(value)));
}

const activeCalendarDate = computed(() => {
  if (!taskDraft.value || !activeDatePicker.value) return '';
  if (activeDatePicker.value === 'dueAt') return taskDraft.value.dueAt;
  if (activeDatePicker.value === 'startAt') return taskDraft.value.startAt;
  return taskDraft.value.reminderDate;
});

const calendarTitle = computed(() => `${calendarViewYear.value}年${calendarViewMonth.value + 1}月`);

const calendarCells = computed<CalendarCell[]>(() => {
  const year = calendarViewYear.value;
  const month = calendarViewMonth.value;
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInCurrentMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const todayKey = toDateKey(new Date());
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

    const dateKey = toDateKey(new Date(cellYear, cellMonth, day));
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

const newTaskCalTitle = computed(() => `${newTaskCalYear.value}年${newTaskCalMonth.value + 1}月`);

const newTaskCalendarCells = computed<CalendarCell[]>(() => {
  const year = newTaskCalYear.value;
  const month = newTaskCalMonth.value;
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInCurrentMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const todayKey = toDateKey(new Date());
  const selectedKey = newTaskDate.value;
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

    const dateKey = toDateKey(new Date(cellYear, cellMonth, day));
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

function toggleNewTaskCalendar(): void {
  if (showNewTaskCalendar.value) {
    showNewTaskCalendar.value = false;
    return;
  }
  const parsed = parseDateKey(newTaskDate.value);
  const base = parsed || new Date();
  newTaskCalYear.value = base.getFullYear();
  newTaskCalMonth.value = base.getMonth();
  showNewTaskCalendar.value = true;
}

function shiftNewTaskCalMonth(delta: number): void {
  const next = new Date(newTaskCalYear.value, newTaskCalMonth.value + delta, 1);
  newTaskCalYear.value = next.getFullYear();
  newTaskCalMonth.value = next.getMonth();
}

function pickNewTaskDate(dateKey: string): void {
  newTaskDate.value = dateKey;
  showNewTaskCalendar.value = false;
}

function clearNewTaskDate(): void {
  newTaskDate.value = '';
  showNewTaskCalendar.value = false;
}

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
  const current = field === 'dueAt'
    ? taskDraft.value.dueAt
    : field === 'startAt'
      ? taskDraft.value.startAt
      : taskDraft.value.reminderDate;
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
  } else if (activeDatePicker.value === 'startAt') {
    taskDraft.value.startAt = dateKey;
  } else {
    taskDraft.value.reminderDate = dateKey;
  }
  closeDatePicker();
}

function clearDateField(field: DateFieldKey): void {
  if (!taskDraft.value) return;
  if (field === 'dueAt') {
    taskDraft.value.dueAt = '';
  } else if (field === 'startAt') {
    taskDraft.value.startAt = '';
  } else {
    taskDraft.value.reminderDate = '';
  }
  if (activeDatePicker.value === field) {
    closeDatePicker();
  }
}

function handleGlobalPointerDown(event: MouseEvent | TouchEvent): void {
  const target = event.target as Node | null;
  if (!target) return;

  // Close new task calendar if clicking outside
  if (showNewTaskCalendar.value) {
    const calRoot = newTaskCalendarWrap.value;
    if (!calRoot || !calRoot.contains(target)) {
      showNewTaskCalendar.value = false;
    }
  }

  if (!activeDatePicker.value) return;

  const root = activeDatePicker.value === 'dueAt'
    ? dueDatePickerWrap.value
    : activeDatePicker.value === 'startAt'
      ? startDatePickerWrap.value
      : reminderDatePickerWrap.value;

  if (root && root.contains(target)) return;
  closeDatePicker();
}

function handleGlobalKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  showNewTaskCalendar.value = false;
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

  const anchorDate = normalized.dueAt || toDateKey(new Date());
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
      startAt: normalized.startAt || null,
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
          pomodoroDuration: taskPomodoroDuration || settingsStore.timer.focusMinutes,
        });
        taskStore.upsertRecurringRule(rule);
        await taskStore.updateTask(editingTaskId, { recurringRuleId: rule.id });
      } else if (hadRepeat && !newRepeatType) {
        if (prevRuleId) {
          await taskStore.updateTask(editingTaskId, { recurringRuleId: null });
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
          pomodoroDuration: taskPomodoroDuration || settingsStore.timer.focusMinutes,
        });
      }
    }

    if (timerStore.currentTaskId === editingTaskId) {
      timerStore.setTask(editingTaskId, normalized.title, normalized.projectId ?? null);
    }

    closeDetail();
  } catch (error) {
    console.error(error);
    showInlineNotice('保存任务失败，请重试');
  }
}

async function deleteSelectedTask(): Promise<void> {
  if (!selectedTask.value) return;
  const taskId = selectedTask.value.id;
  const removedIds = new Set<number>([taskId]);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const task of taskStore.tasks) {
      if (task.parentId != null && removedIds.has(task.parentId) && !removedIds.has(task.id)) {
        removedIds.add(task.id);
        expanded = true;
      }
    }
  }
  selectedTaskId.value = null;
  try {
    await taskStore.removeTask(taskId);
    if (timerStore.currentTaskId != null && removedIds.has(timerStore.currentTaskId)) {
      timerStore.clearTask();
    }
  } catch (error) {
    console.error(error);
    showInlineNotice('删除任务失败，请重试');
  }
}

async function undoDeleteTask(): Promise<void> {
  const success = await taskStore.undoLastDeletion();
  if (!success) {
    showInlineNotice('撤销失败，可能已超过可撤销时间');
  }
}

function startFocusOnTask(taskId: number, taskTitle: string, projectId: number | null = null): void {
  const success = timerStore.setTask(taskId, taskTitle, projectId);
  if (!success) {
    showInlineNotice('计时进行中，需先结束当前计时后再切换任务');
    return;
  }
  timerStore.start();
  focusModal.open();
}

function getProjectName(projectId: number): string {
  const target = taskStore.projects.find(item => item.id === projectId);
  return target ? target.title : '未分类';
}

function priorityBarClass(priority: number): string {
  switch (priority) {
    case 3: return 'bg-danger-500';
    case 2: return 'bg-warning-400';
    case 1: return 'bg-primary-400';
    default: return 'bg-transparent';
  }
}

function priorityCheckboxClass(priority: number): string {
  switch (priority) {
    case 3: return 'border-danger-400 ring-1 ring-danger-100';
    case 2: return 'border-warning-400 ring-1 ring-warning-100';
    case 1: return 'border-primary-400 ring-1 ring-primary-100';
    default: return 'border-surface-border-hover';
  }
}

function priorityBadge(priority: number): { label: string; cls: string } | null {
  switch (priority) {
    case 3: return { label: '高', cls: 'bg-danger-50 text-danger-500 ring-1 ring-danger-200' };
    case 2: return { label: '中', cls: 'bg-warning-50 text-warning-500 ring-1 ring-warning-200' };
    case 1: return { label: '低', cls: 'bg-primary-50 text-primary-500 ring-1 ring-primary-200' };
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
  clearAllPanels();
  if (undoTickTimer) {
    clearInterval(undoTickTimer);
    undoTickTimer = null;
  }
  if (inlineNoticeTimer) {
    clearTimeout(inlineNoticeTimer);
    inlineNoticeTimer = null;
  }
  if (inlineConfirmState.value) {
    inlineConfirmState.value.resolve(false);
    inlineConfirmState.value = null;
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

  // Initialize keyword cache for self-learning suggestions
  refreshKnownKeywords().catch(() => {});
});

// ── "All" view: lazy-load older completed/cancelled tasks on scroll ─────────
// Working set covers everything for today/project; only "all" view needs the
// archive. Fire when the user scrolls within 200px of the bottom. Reentry is
// guarded by taskStore.archiveLoading.

async function handleTaskListScroll(): Promise<void> {
  if (activeTaskFilter.value !== 'all') return;
  if (taskStore.archiveExhausted || taskStore.archiveLoading) return;

  const el = taskScrollContainer.value;
  if (!el) return;

  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  if (distanceFromBottom > 200) return;

  try {
    await taskStore.loadMoreArchive();
  } catch (err) {
    console.warn('[TasksView] Failed to load archive page:', err);
  }
}

// When the user enters "all" the first time the list may not fill the
// viewport, so a manual scroll never fires. Trigger one initial load.
watch(activeTaskFilter, (filter) => {
  if (filter === 'all' && !taskStore.archiveExhausted && !taskStore.archiveLoading) {
    void taskStore.loadMoreArchive();
  }
}, { immediate: true });
</script>

<template>
  <div class="flex h-full min-w-0 items-stretch">
    <!-- Main Task List -->
    <div class="flex min-w-0 flex-1 flex-col">
      <!-- Header -->
      <div class="border-b border-surface-border bg-white px-6 py-4">
        <div class="flex items-end justify-between">
          <h1 class="text-xl font-semibold tracking-tight text-[#1C1C1A]">{{ pageTitle }}</h1>
        </div>

        <!-- Stats Bar -->
        <div class="mt-3 grid grid-cols-4 gap-3 rounded-lg bg-surface-hover p-3">
          <div class="text-center">
            <div class="text-xl font-semibold tabular-nums text-primary-500">{{ estimatedTime.value }}<span class="text-xs text-[#9E9E9A]">{{ estimatedTime.unit }}</span></div>
            <div class="text-xs text-[#6F6F6B]">预计时间</div>
          </div>
          <div class="text-center">
            <div class="text-xl font-semibold tabular-nums text-primary-500">{{ tasksToComplete }}</div>
            <div class="text-xs text-[#6F6F6B]">待完成任务</div>
          </div>
          <div class="text-center">
            <div class="text-xl font-semibold tabular-nums text-primary-500">{{ elapsedTime.value }}<span class="text-xs text-[#9E9E9A]">{{ elapsedTime.unit }}</span></div>
            <div class="text-xs text-[#6F6F6B]">已用时间</div>
          </div>
          <div class="text-center">
            <div class="text-xl font-semibold tabular-nums text-success-500">{{ completedTasks }}</div>
            <div class="text-xs text-[#6F6F6B]">已完成任务</div>
          </div>
        </div>
      </div>

      <!-- Task Input -->
      <div class="border-b border-surface-border bg-white px-6 py-3">
        <div class="flex items-center gap-3">
          <svg class="h-4 w-4 text-[#9E9E9A]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          <input
            v-model="title"
            type="text"
            aria-label="新增任务"
            placeholder="添加任务，按 Enter 保存…"
            class="flex-1 text-sm text-[#6F6F6B] placeholder:text-[#9E9E9A] focus:outline-none"
            @keyup.enter="submitTask"
          />

          <!-- Date Picker for new task -->
          <div ref="newTaskCalendarWrap" class="relative">
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
              :class="newTaskDate
                ? 'border-primary-300 bg-primary-50 text-primary-700'
                : 'border-surface-border text-[#9E9E9A] hover:bg-surface-hover hover:text-[#6F6F6B]'"
              @click="toggleNewTaskCalendar"
            >
              <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span v-if="newTaskDate">{{ formatDueAt(newTaskDate) }}</span>
            </button>
            <button
              v-if="newTaskDate"
              class="ml-0.5 rounded p-0.5 text-[#9E9E9A] hover:bg-surface-hover hover:text-[#6F6F6B]"
              aria-label="清除日期"
              @click.stop="clearNewTaskDate"
            >
              <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <!-- Calendar Popup -->
            <div
              v-if="showNewTaskCalendar"
              class="absolute right-0 top-[calc(100%+8px)] z-50 w-72 rounded-lg border border-surface-border bg-white p-3 shadow-xl"
            >
              <div class="mb-2 flex items-center justify-between">
                <button
                  type="button"
                  class="rounded p-1 text-[#6F6F6B] hover:bg-surface-hover"
                  aria-label="上一月"
                  @click="shiftNewTaskCalMonth(-1)"
                >
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <div class="text-sm font-medium text-[#1C1C1A]">{{ newTaskCalTitle }}</div>
                <button
                  type="button"
                  class="rounded p-1 text-[#6F6F6B] hover:bg-surface-hover"
                  aria-label="下一月"
                  @click="shiftNewTaskCalMonth(1)"
                >
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
              <div class="mb-1 grid grid-cols-7 text-center text-[11px] text-[#9E9E9A]">
                <span v-for="week in calendarWeekdays" :key="week">{{ week }}</span>
              </div>
              <div class="grid grid-cols-7 gap-1">
                <button
                  v-for="cell in newTaskCalendarCells"
                  :key="cell.dateKey"
                  type="button"
                  class="h-8 rounded text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
                  :class="cell.isSelected
                    ? 'bg-primary-600 text-white'
                    : cell.inCurrentMonth
                      ? (cell.isToday ? 'border border-primary-300 text-primary-500' : 'text-[#1C1C1A] hover:bg-surface-hover')
                      : 'text-[#9E9E9A] hover:bg-surface-hover'"
                  @click="pickNewTaskDate(cell.dateKey)"
                >
                  {{ cell.day }}
                </button>
              </div>
            </div>
          </div>

          <button
            class="rounded-md bg-[#1C1C1A] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#2A2A28] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
            @click="submitTask"
          >
            提交
          </button>
        </div>
      </div>

      <!-- Task List -->
      <div
        ref="taskScrollContainer"
        class="flex-1 overflow-auto bg-surface-hover p-6"
        @scroll="handleTaskListScroll"
      >
        <div
          v-if="displayTasks.length > 0"
          ref="taskListWrap"
          :class="activeTaskFilter === 'all' ? 'relative pb-10' : 'relative'"
        >
            <component
              :is="canDragSort ? TransitionGroup : 'div'"
              :name="canDragSort ? 'task-sort' : undefined"
              :tag="canDragSort ? 'div' : undefined"
              :class="activeTaskFilter === 'all' ? 'space-y-3.5' : 'space-y-2'"
            >
              <div
                v-for="(task, taskIndex) in displayTasks"
                :key="task.id"
                class="space-y-0"
              >
                <div
                  v-if="shouldRenderTimelineHeader(taskIndex)"
                  :class="[taskIndex === 0 ? 'mb-3 mt-1' : 'mb-3 mt-6', 'flex cursor-pointer items-center gap-3 select-none']"
                  @click="toggleGroupCollapse(getTimelineDateKey(task))"
                >
                  <svg
                    class="h-3.5 w-3.5 shrink-0 text-[#9E9E9A] transition-transform"
                    :class="isGroupCollapsed(getTimelineDateKey(task)) ? '' : 'rotate-90'"
                    viewBox="0 0 20 20" fill="currentColor"
                  >
                    <path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" />
                  </svg>
                  <h3 class="text-sm font-semibold text-[#6F6F6B]">{{ getTimelineHeaderLabel(task) }}</h3>
                  <span class="text-xs text-[#9E9E9A]">{{ getTimelineHeaderCount(task) }} 项</span>
                  <button
                    v-if="isTimelineGroupOverdue(task)"
                    class="flex items-center gap-1 shrink-0 rounded-md px-2 py-1 text-xs font-medium text-[#9E9E9A] transition-colors hover:bg-surface-hover hover:text-[#6F6F6B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
                    @click.stop="copyGroupToToday(task)"
                  >
                    <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                    </svg>
                    复制到今天
                  </button>
                  <div class="h-px flex-1 bg-surface-border" />
                </div>

                <div
                  v-show="!isTaskInCollapsedGroup(task)"
                  :data-task-id="task.id"
                  class="group relative flex cursor-pointer overflow-hidden rounded-xl border border-surface-border bg-white transition-all"
                  :class="[
                    selectedTaskId === task.id ? 'border-primary-300 ring-2 ring-primary-200/80' : '',
                    isTaskDragging ? '' : 'hover:border-surface-border-hover hover:shadow-sm',
                    canDragSort
                      ? (draggingTaskId === task.id && isTaskDragging ? 'cursor-grabbing' : 'cursor-grab active:cursor-grabbing')
                      : '',
                    draggingTaskId === task.id && isTaskDragging ? 'task-drag-origin pointer-events-none opacity-35' : '',
                    task.status === 'done' ? 'border-success-200' : '',
                    isTaskOverdue(task) ? 'border-danger-300 shadow-[inset_0_0_0_1px_rgba(239,68,68,0.15)]' : '',
                    task.rescheduledTo ? 'opacity-50' : ''
                  ]"
                  @pointerdown="onTaskPointerDown($event, task.id)"
                  @click="selectTask(task.id)"
                >
                  <!-- Priority Bar -->
                  <div
                    class="my-2 ml-1 w-1.5 shrink-0 rounded-full transition-colors"
                    :class="dragOverTaskId === task.id && draggingTaskId !== task.id ? 'bg-primary-500' : priorityBarClass(task.priority)"
                  />

                  <div class="flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5">
                    <!-- Checkbox -->
                    <button
                      role="checkbox"
                      :aria-checked="task.status === 'done'"
                      :aria-label="task.status === 'done' ? '标记为未完成' : '标记为已完成'"
                      class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
                      :class="task.status === 'done'
                        ? 'border-success-500 bg-success-500'
                        : priorityCheckboxClass(task.priority) + ' hover:border-danger-400'"
                      @click.stop="handleToggleTask(task.id)"
                    >
                      <svg v-if="task.status === 'done'" class="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                      </svg>
                    </button>

                    <!-- Task Title -->
                    <span
                      class="min-w-0 flex-1 truncate text-sm"
                      :class="[
                        task.status === 'done' ? 'text-[#9E9E9A] line-through' : '',
                        task.rescheduledTo ? 'text-[#9E9E9A] line-through' : '',
                        !task.rescheduledTo && task.status !== 'done' ? 'text-[#1C1C1A]' : '',
                      ]"
                    >
                      {{ task.title }}
                    </span>

                    <!-- Rescheduled badge -->
                    <span
                      v-if="task.rescheduledTo"
                      class="shrink-0 rounded-full bg-surface-hover px-2 py-0.5 text-[11px] text-[#9E9E9A]"
                    >
                      已推迟到 {{ formatRescheduledDate(task.rescheduledTo) }}
                    </span>

                    <!-- Subtask Count -->
                    <span
                      v-if="hasTaskSubtasks(task.id)"
                      class="inline-flex items-center gap-1 rounded-full border border-surface-border px-2.5 py-1 text-xs text-[#6F6F6B]"
                    >
                      <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                      </svg>
                      <span>{{ getTaskSubtaskDoneCount(task.id) }}/{{ getTaskSubtasks(task.id).length }}</span>
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
                    <div class="flex items-center gap-1 text-xs text-[#9E9E9A]">
                      <div class="flex items-center gap-0.5">
                        <span
                          v-for="dotIndex in Math.min(task.pomodoroCount || 1, 5)"
                          :key="dotIndex"
                          class="h-2 w-2 rounded-full"
                          :class="dotIndex <= (task.pomodoroCount || 1)
                            ? (task.status === 'done' ? 'bg-success-400' : 'bg-danger-400')
                            : (task.status === 'done' ? 'bg-success-200' : 'bg-danger-200')"
                        />
                      </div>
                      <span v-if="(task.pomodoroCount || 1) > 5">+{{ (task.pomodoroCount || 1) - 5 }}</span>
                    </div>

                    <!-- Due Date -->
                    <span class="text-xs" :class="task.status === 'done' ? 'font-medium text-success-500' : isTaskOverdue(task) ? 'font-medium text-danger-500' : task.dueAt ? 'text-rose-500' : 'text-[#9E9E9A]'">
                      {{ formatDueAt(task.dueAt) }}
                      <span v-if="task.status === 'done'" class="ml-0.5 rounded bg-success-50 px-1 py-0.5 text-[10px] text-success-500 ring-1 ring-success-200">已完成</span>
                      <span v-else-if="isTaskOverdue(task)" class="ml-0.5 rounded bg-danger-50 px-1 py-0.5 text-[10px] text-danger-500 ring-1 ring-danger-200">已逾期</span>
                    </span>

                    <!-- Copy to today -->
                    <button
                      v-if="canCopyTaskToToday(task)"
                      class="flex items-center gap-1 shrink-0 rounded px-2 py-1 text-[11px] font-medium text-[#9E9E9A] transition-colors hover:bg-surface-hover hover:text-[#6F6F6B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/40"
                      aria-label="复制到今天"
                      @click.stop="copySingleTaskToToday(task.id)"
                    >
                      <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                      </svg>
                      复制
                    </button>

                    <!-- Quick Focus -->
                    <button
                      class="flex items-center gap-1 shrink-0 rounded px-2 py-1 text-[11px] font-medium text-[#9E9E9A] transition-colors hover:bg-surface-hover hover:text-[#6F6F6B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
                      aria-label="设为当前专注任务"
                      @click.stop="startFocusOnTask(task.id, task.title, task.projectId)"
                    >
                      <svg class="h-3 w-3" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                      专注
                    </button>
                  </div>
                </div>
              </div>
            </component>

            <!-- "All" view: archive loading status row -->
            <div
              v-if="activeTaskFilter === 'all'"
              class="mt-4 flex items-center justify-center py-3 text-xs text-[#9E9E9A]"
              aria-live="polite"
            >
              <span v-if="taskStore.archiveLoading" class="inline-flex items-center gap-2">
                <svg class="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" stroke-opacity="0.25" stroke-width="2.5"/>
                  <path d="M22 12a10 10 0 0 1-10 10" stroke-width="2.5" stroke-linecap="round"/>
                </svg>
                正在加载更多历史…
              </span>
              <span v-else-if="taskStore.archiveExhausted">已加载全部历史任务</span>
              <span v-else>滚动到底部以加载更多</span>
            </div>

          </div>

          <!-- Empty State -->
          <div v-else class="flex h-full flex-col items-center justify-center">
            <div class="flex h-24 w-24 items-center justify-center rounded-full bg-surface-hover">
              <svg class="h-12 w-12 text-[#9E9E9A]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p class="mt-4 text-[#6F6F6B]">暂无任务</p>
            <p class="mt-1 text-sm text-[#9E9E9A]">点击上方输入框添加新任务</p>
          </div>
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
        class="relative h-full min-h-0 shrink-0 self-stretch border-l border-surface-border bg-white"
        :style="{ width: `${detailPanelWidth}px` }"
      >
        <button
          class="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize bg-transparent transition-colors hover:bg-primary-200/40"
          aria-label="拖拽调整宽度"
          @mousedown="startResize"
        />

        <div class="flex h-full flex-col">
          <!-- Detail Header -->
          <div class="flex items-center gap-3 border-b border-surface-border p-4">
            <button
              role="checkbox"
              :aria-checked="selectedTask.status === 'done'"
              :aria-label="selectedTask.status === 'done' ? '标记为未完成' : '标记为已完成'"
              class="flex h-5 w-5 items-center justify-center rounded-full border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
              :class="selectedTask.status === 'done' ? 'border-success-500 bg-success-500' : 'border-surface-border-hover'"
              @click="handleToggleTask(selectedTask.id)"
            >
              <svg v-if="selectedTask.status === 'done'" class="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
              </svg>
            </button>
            <input
              v-model="taskDraft.title"
              type="text"
              aria-label="任务标题"
              class="flex-1 rounded border border-surface-border px-2 py-1 font-medium text-[#1C1C1A] focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="任务标题…"
            >
            <button class="text-[#9E9E9A] hover:text-[#6F6F6B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40" aria-label="关闭详情" @click="closeDetail">
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Detail Content -->
          <div class="flex-1 overflow-auto p-4">
            <div class="space-y-4">
              <!-- Priority -->
              <div class="rounded-lg border border-surface-border p-3">
                <label class="mb-2 flex items-center gap-2 text-sm text-[#1C1C1A]">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
                  </svg>
                  优先级
                </label>
                <div class="flex gap-2">
                  <button
                    v-for="opt in priorityOptions"
                    :key="opt.value"
                    class="flex-1 rounded border px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
                    :class="taskDraft.priority === opt.value ? opt.activeColor : opt.color + ' hover:bg-surface-hover'"
                    @click="taskDraft.priority = opt.value"
                  >
                    {{ opt.label }}
                  </button>
                </div>
              </div>

              <!-- Pomodoro Quantity -->
              <div class="rounded-lg border border-surface-border p-3">
                <label class="mb-2 flex items-center gap-2 text-sm text-[#1C1C1A]" for="task-pomodoro-count">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  番茄数量
                </label>
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <button
                      class="h-8 w-8 rounded border border-surface-border text-[#6F6F6B] hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
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
                      class="pomodoro-input w-16 rounded border border-surface-border px-2 py-1 text-center text-sm focus:border-primary-500 focus:outline-none"
                      @blur="taskDraft.pomodoroCount = clampPomodoro(taskDraft.pomodoroCount)"
                    >
                    <button
                      class="h-8 w-8 rounded border border-surface-border text-[#6F6F6B] hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
                      aria-label="增加番茄数量"
                      @click="changePomodoro(1)"
                    >
                      +
                    </button>
                  </div>
                  <div class="text-sm tabular-nums text-[#6F6F6B]">≈ {{ taskDraft.pomodoroCount * settingsStore.timer.focusMinutes }} 分钟</div>
                </div>
              </div>

              <!-- Start Date -->
              <div class="rounded-lg border border-surface-border p-3">
                <label class="mb-2 flex items-center gap-2 text-sm text-[#1C1C1A]" for="task-start-at">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  开始日期
                </label>
                <div class="flex items-center gap-2">
                  <div ref="startDatePickerWrap" class="relative min-w-0 flex-1">
                    <button
                      id="task-start-at"
                      type="button"
                      class="h-10 w-full rounded border border-surface-border px-3 text-left text-sm focus:border-primary-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
                      :class="taskDraft.startAt ? 'text-[#1C1C1A]' : 'text-[#9E9E9A]'"
                      @click="openDatePicker('startAt')"
                    >
                      {{ formatDateInputLabel(taskDraft.startAt) || '选择日期' }}
                    </button>

                    <div
                      v-if="isDatePickerOpen('startAt')"
                      class="absolute left-0 top-[calc(100%+8px)] z-50 w-72 rounded-lg border border-surface-border bg-white p-3 shadow-xl"
                    >
                      <div class="mb-2 flex items-center justify-between">
                        <button
                          type="button"
                          class="rounded p-1 text-[#6F6F6B] hover:bg-surface-hover"
                          aria-label="上一月"
                          @click="shiftCalendarMonth(-1)"
                        >
                          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                          </svg>
                        </button>
                        <div class="text-sm font-medium text-[#1C1C1A]">{{ calendarTitle }}</div>
                        <button
                          type="button"
                          class="rounded p-1 text-[#6F6F6B] hover:bg-surface-hover"
                          aria-label="下一月"
                          @click="shiftCalendarMonth(1)"
                        >
                          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      </div>
                      <div class="mb-1 grid grid-cols-7 text-center text-[11px] text-[#9E9E9A]">
                        <span v-for="week in calendarWeekdays" :key="week">{{ week }}</span>
                      </div>
                      <div class="grid grid-cols-7 gap-1">
                        <button
                          v-for="cell in calendarCells"
                          :key="cell.dateKey"
                          type="button"
                          class="h-8 rounded text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
                          :class="cell.isSelected
                            ? 'bg-primary-600 text-white'
                            : cell.inCurrentMonth
                              ? (cell.isToday ? 'border border-primary-300 text-primary-500' : 'text-[#1C1C1A] hover:bg-surface-hover')
                              : 'text-[#9E9E9A] hover:bg-surface-hover'"
                          @click="pickDate(cell.dateKey)"
                        >
                          {{ cell.day }}
                        </button>
                      </div>
                    </div>
                  </div>

                  <button
                    v-if="taskDraft.startAt"
                    class="h-10 min-w-[52px] shrink-0 rounded border border-surface-border px-2 text-xs text-[#6F6F6B] hover:bg-surface-hover"
                    @click="clearDateField('startAt')"
                  >
                    清除
                  </button>
                </div>
              </div>

              <!-- Due Date -->
              <div class="rounded-lg border border-surface-border p-3">
                <label class="mb-2 flex items-center gap-2 text-sm text-[#1C1C1A]" for="task-due-at">
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
                      class="h-10 w-full rounded border border-surface-border px-3 text-left text-sm focus:border-primary-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
                      :class="taskDraft.dueAt ? 'text-[#1C1C1A]' : 'text-[#9E9E9A]'"
                      @click="openDatePicker('dueAt')"
                    >
                      {{ formatDateInputLabel(taskDraft.dueAt) || '选择日期' }}
                    </button>

                    <div
                      v-if="isDatePickerOpen('dueAt')"
                      class="absolute left-0 top-[calc(100%+8px)] z-50 w-72 rounded-lg border border-surface-border bg-white p-3 shadow-xl"
                    >
                      <div class="mb-2 flex items-center justify-between">
                        <button
                          type="button"
                          class="rounded p-1 text-[#6F6F6B] hover:bg-surface-hover"
                          aria-label="上一月"
                          @click="shiftCalendarMonth(-1)"
                        >
                          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                          </svg>
                        </button>
                        <div class="text-sm font-medium text-[#1C1C1A]">{{ calendarTitle }}</div>
                        <button
                          type="button"
                          class="rounded p-1 text-[#6F6F6B] hover:bg-surface-hover"
                          aria-label="下一月"
                          @click="shiftCalendarMonth(1)"
                        >
                          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      </div>
                      <div class="mb-1 grid grid-cols-7 text-center text-[11px] text-[#9E9E9A]">
                        <span v-for="week in calendarWeekdays" :key="week">{{ week }}</span>
                      </div>
                      <div class="grid grid-cols-7 gap-1">
                        <button
                          v-for="cell in calendarCells"
                          :key="cell.dateKey"
                          type="button"
                          class="h-8 rounded text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
                          :class="cell.isSelected
                            ? 'bg-primary-600 text-white'
                            : cell.inCurrentMonth
                              ? (cell.isToday ? 'border border-primary-300 text-primary-500' : 'text-[#1C1C1A] hover:bg-surface-hover')
                              : 'text-[#9E9E9A] hover:bg-surface-hover'"
                          @click="pickDate(cell.dateKey)"
                        >
                          {{ cell.day }}
                        </button>
                      </div>
                    </div>
                  </div>

                  <button
                    v-if="taskDraft.dueAt"
                    class="h-10 min-w-[52px] shrink-0 rounded border border-surface-border px-2 text-xs text-[#6F6F6B] hover:bg-surface-hover"
                    @click="clearDateField('dueAt')"
                  >
                    清除
                  </button>
                </div>
              </div>

              <!-- Project -->
              <div class="rounded-lg border border-surface-border p-3">
                <label class="mb-2 flex items-center gap-2 text-sm text-[#1C1C1A]" for="task-project-id">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  所属清单
                </label>
                <select
                  id="task-project-id"
                  v-model="taskDraft.projectId"
                  class="h-10 w-full rounded border border-surface-border px-3 text-sm text-[#1C1C1A] focus:border-primary-500 focus:outline-none"
                >
                  <option :value="null">无</option>
                  <option v-for="project in taskStore.projects" :key="project.id" :value="project.id">
                    {{ project.title }}
                  </option>
                </select>
              </div>

              <!-- Reminder -->
              <div class="rounded-lg border border-surface-border p-3">
                <label class="mb-2 flex items-center gap-2 text-sm text-[#1C1C1A]" for="task-reminder-at">
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
                      class="h-10 w-full rounded border border-surface-border px-3 text-left text-sm focus:border-primary-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
                      :class="taskDraft.reminderDate ? 'text-[#1C1C1A]' : 'text-[#9E9E9A]'"
                      @click="openDatePicker('reminderDate')"
                    >
                      {{ formatDateInputLabel(taskDraft.reminderDate) || '选择日期' }}
                    </button>

                    <div
                      v-if="isDatePickerOpen('reminderDate')"
                      class="absolute left-0 top-[calc(100%+8px)] z-50 w-72 rounded-lg border border-surface-border bg-white p-3 shadow-xl"
                    >
                      <div class="mb-2 flex items-center justify-between">
                        <button
                          type="button"
                          class="rounded p-1 text-[#6F6F6B] hover:bg-surface-hover"
                          aria-label="上一月"
                          @click="shiftCalendarMonth(-1)"
                        >
                          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                          </svg>
                        </button>
                        <div class="text-sm font-medium text-[#1C1C1A]">{{ calendarTitle }}</div>
                        <button
                          type="button"
                          class="rounded p-1 text-[#6F6F6B] hover:bg-surface-hover"
                          aria-label="下一月"
                          @click="shiftCalendarMonth(1)"
                        >
                          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      </div>
                      <div class="mb-1 grid grid-cols-7 text-center text-[11px] text-[#9E9E9A]">
                        <span v-for="week in calendarWeekdays" :key="week">{{ week }}</span>
                      </div>
                      <div class="grid grid-cols-7 gap-1">
                        <button
                          v-for="cell in calendarCells"
                          :key="cell.dateKey"
                          type="button"
                          class="h-8 rounded text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
                          :class="cell.isSelected
                            ? 'bg-primary-600 text-white'
                            : cell.inCurrentMonth
                              ? (cell.isToday ? 'border border-primary-300 text-primary-500' : 'text-[#1C1C1A] hover:bg-surface-hover')
                              : 'text-[#9E9E9A] hover:bg-surface-hover'"
                          @click="pickDate(cell.dateKey)"
                        >
                          {{ cell.day }}
                        </button>
                      </div>
                    </div>
                  </div>

                  <select
                    v-model="taskDraft.reminderTime"
                    class="h-10 w-24 shrink-0 rounded border border-surface-border px-2 text-sm text-[#1C1C1A] focus:border-primary-500 focus:outline-none sm:w-28"
                  >
                    <option v-for="time in reminderTimeOptions" :key="time" :value="time">{{ time }}</option>
                  </select>
                  <button
                    v-if="taskDraft.reminderDate"
                    class="h-10 min-w-[52px] shrink-0 rounded border border-surface-border px-2 text-xs text-[#6F6F6B] hover:bg-surface-hover"
                    @click="clearDateField('reminderDate')"
                  >
                    清除
                  </button>
                </div>
                <p class="mt-2 text-xs text-[#9E9E9A]">当前：{{ formatReminder(toReminderIso(taskDraft.reminderDate, taskDraft.reminderTime)) }}</p>
              </div>

              <!-- Repeat -->
              <div class="rounded-lg border border-surface-border p-3">
                <label class="mb-2 flex items-center gap-2 text-sm text-[#1C1C1A]" for="task-repeat-rule">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  重复
                </label>
                <select
                  id="task-repeat-rule"
                  v-model="taskDraft.repeatRule"
                  class="h-10 w-full rounded border border-surface-border px-3 text-sm text-[#1C1C1A] focus:border-primary-500 focus:outline-none"
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
                    class="flex h-8 w-8 items-center justify-center rounded-full border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
                    :class="taskDraft.repeatDays.includes(idx + 1)
                      ? 'border-primary-500 bg-primary-500 text-white'
                      : 'border-surface-border text-[#6F6F6B] hover:bg-surface-hover'"
                    @click="toggleRepeatDay(idx + 1)"
                  >
                    {{ label }}
                  </button>
                </div>
                <p v-if="taskDraft.repeatRule && !taskDraft.dueAt" class="mt-2 text-xs text-warning-500">
                  重复任务需要先设置本次截止日期（将作为重复锚点）
                </p>
                <p v-else-if="taskDraft.repeatRule" class="mt-2 text-xs text-[#9E9E9A]">
                  重复锚点：使用本次截止日期
                </p>
              </div>

              <!-- Subtasks -->
              <div class="rounded-lg border border-surface-border bg-white p-3">
                <div class="mb-2 flex items-center justify-between">
                  <label class="flex items-center gap-2 text-sm font-medium text-[#1C1C1A]">
                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5h10M9 12h10M9 19h10M4 6h.01M4 12h.01M4 18h.01" />
                    </svg>
                    子任务
                  </label>
                  <div class="flex items-center gap-2">
                    <button
                      class="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
                      :class="currentSuggestionPanel?.loading
                        ? 'bg-primary-50 text-primary-400 cursor-not-allowed'
                        : 'text-primary-500 hover:bg-primary-50'"
                      :disabled="currentSuggestionPanel?.loading"
                      @click="handleRequestSuggestions"
                    >
                      <svg v-if="currentSuggestionPanel?.loading" class="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <svg v-else class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                      </svg>
                      {{ currentSuggestionPanel?.loading ? '加载中…' : '建议' }}
                    </button>
                    <span class="rounded-full border border-surface-border bg-surface-hover px-2 py-0.5 text-xs text-[#6F6F6B]">{{ subtaskDoneCount }}/{{ selectedTaskSubtasks.length }}</span>
                  </div>
                </div>

                <div v-if="!canAddSubtaskToSelected" class="rounded-lg border border-surface-border bg-white px-3 py-2 text-xs text-[#6F6F6B]">
                  已达最大嵌套层级（{{ MAX_TASK_DEPTH }} 层），无法继续添加子任务
                </div>
                <div v-else class="mb-3 flex items-center gap-2">
                  <input
                    v-model="subtaskTitle"
                    type="text"
                    aria-label="新增子任务"
                    placeholder="添加子任务，按 Enter 保存…"
                    class="h-9 flex-1 rounded-lg border border-surface-border bg-white px-3 text-sm text-[#1C1C1A] placeholder:text-[#9E9E9A] focus:border-primary-500 focus:outline-none"
                    @keyup.enter="submitSubtask"
                  >
                  <button
                    class="h-9 shrink-0 rounded-lg bg-[#1C1C1A] px-3 text-xs font-medium text-white transition-colors hover:bg-[#2A2A28] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
                    @click="submitSubtask"
                  >
                    添加
                  </button>
                </div>


                <div v-if="selectedTaskSubtasks.length > 0" class="space-y-1.5">
                  <div
                    v-for="subtask in selectedTaskSubtasks"
                    :key="subtask.id"
                    class="flex items-center gap-2 rounded-lg border border-surface-border bg-surface-hover/40 px-2.5 py-2 transition-colors hover:bg-surface-hover"
                  >
                    <div class="h-7 w-1 shrink-0 rounded-full opacity-70" :class="priorityBarClass(subtask.priority)" />
                    <button
                      role="checkbox"
                      :aria-checked="subtask.status === 'done'"
                      :aria-label="subtask.status === 'done' ? '标记为未完成' : '标记为已完成'"
                      class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
                      :class="subtask.status === 'done' ? 'border-success-500 bg-success-500' : 'border-surface-border-hover'"
                      @click="handleToggleTask(subtask.id)"
                    >
                      <svg v-if="subtask.status === 'done'" class="h-2.5 w-2.5 text-white" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                      </svg>
                    </button>
                    <button
                      class="min-w-0 flex-1 truncate text-left text-sm"
                      :class="subtask.status === 'done' ? 'text-[#9E9E9A] line-through' : 'text-[#1C1C1A]'"
                      @click="selectTask(subtask.id)"
                    >
                      {{ subtask.title }}
                    </button>
                    <span
                      v-if="hasTaskSubtasks(subtask.id)"
                      class="shrink-0 rounded border border-surface-border bg-white px-1.5 py-0.5 text-[10px] text-[#6F6F6B]"
                    >
                      {{ getTaskSubtaskDoneCount(subtask.id) }}/{{ getTaskSubtasks(subtask.id).length }} 子任务
                    </span>
                    <span
                      v-if="priorityBadge(subtask.priority)"
                      class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none"
                      :class="priorityBadge(subtask.priority)!.cls"
                    >
                      {{ priorityBadge(subtask.priority)!.label }}
                    </span>
                    <div class="flex items-center gap-1 text-xs text-[#9E9E9A]">
                      <div class="flex items-center gap-0.5">
                        <span
                          v-for="dotIndex in Math.min(subtask.pomodoroCount || 1, 5)"
                          :key="dotIndex"
                          class="h-1.5 w-1.5 rounded-full"
                          :class="dotIndex <= (subtask.pomodoroCount || 1) ? 'bg-danger-400' : 'bg-danger-200'"
                        />
                      </div>
                      <span v-if="(subtask.pomodoroCount || 1) > 5">+{{ (subtask.pomodoroCount || 1) - 5 }}</span>
                    </div>
                    <span class="text-xs" :class="isTaskOverdue(subtask) ? 'font-medium text-danger-500' : subtask.dueAt ? 'text-rose-500' : 'text-[#9E9E9A]'">
                      {{ formatDueAt(subtask.dueAt) }}
                      <span v-if="isTaskOverdue(subtask)" class="ml-0.5 rounded bg-danger-50 px-1 py-0.5 text-[10px] text-danger-500 ring-1 ring-danger-200">已逾期</span>
                    </span>
                    <button
                      class="shrink-0 rounded px-2 py-1 text-xs text-danger-400 hover:bg-danger-50 hover:text-danger-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger-500/40"
                      @click="deleteSubtask(subtask.id)"
                    >
                      删除
                    </button>
                  </div>
                </div>
                <p v-else class="text-xs text-[#9E9E9A]">暂无子任务</p>

                <!-- Suggestion Panel (below subtask list) -->
                <div
                  v-if="currentSuggestionPanel?.requested && !currentSuggestionPanel.collapsed"
                  class="mt-3 rounded-lg border border-primary-200 bg-primary-50/40"
                >
                  <!-- Panel header -->
                  <button
                    class="flex w-full items-center justify-between px-3 py-2 text-left"
                    @click="selectedTask && toggleSuggestionCollapsed(selectedTask.id)"
                  >
                    <div class="flex items-center gap-1.5">
                      <svg class="h-3.5 w-3.5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                      <span class="text-xs font-semibold text-primary-700">
                        建议
                        <span v-if="currentSuggestionPanel.suggestions.length > 0" class="font-normal text-primary-500">
                          ({{ currentSuggestionPanel.suggestions.length }} 条)
                        </span>
                      </span>
                    </div>
                    <div class="flex items-center gap-1">
                      <button
                        v-if="!currentSuggestionPanel.collapsed && currentSuggestionPanel.suggestions.length > 0"
                        class="rounded bg-primary-600 px-2 py-0.5 text-[11px] font-medium text-white transition-colors hover:bg-primary-700"
                        @click.stop="handleAcceptAllSuggestions"
                      >
                        全部添加
                      </button>
                      <button
                        v-if="!currentSuggestionPanel.collapsed"
                        class="rounded border border-primary-200 px-2 py-0.5 text-[11px] font-medium text-primary-500 transition-colors hover:bg-primary-100"
                        @click.stop="handleDismissSuggestions"
                      >
                        忽略
                      </button>
                      <svg
                        class="h-4 w-4 text-primary-400 transition-transform"
                        :class="currentSuggestionPanel.collapsed ? '-rotate-90' : ''"
                        fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"
                      >
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  <!-- Panel content (collapsible) -->
                  <div v-if="!currentSuggestionPanel.collapsed" class="space-y-1 px-3 pb-3">
                    <div
                      v-for="s in currentSuggestionPanel.suggestions"
                      :key="s.title"
                      class="flex items-center justify-between gap-2 rounded-md bg-white px-2.5 py-1.5"
                    >
                      <div class="flex min-w-0 items-center gap-1.5">
                        <span
                          class="shrink-0 rounded px-1 py-0.5 text-[9px] font-medium leading-none"
                          :class="s.source === 'ai'
                            ? 'bg-violet-100 text-violet-600'
                            : s.source === 'pattern'
                              ? 'bg-success-100 text-success-500'
                              : 'bg-primary-100 text-primary-500'"
                        >
                          {{ s.source === 'ai' ? '远程' : s.source === 'pattern' ? '模板' : '学习' }}
                        </span>
                        <div class="min-w-0">
                          <span class="block truncate text-xs text-[#1C1C1A]">{{ s.title }}</span>
                          <span v-if="s.childCount" class="block text-[10px] text-[#9E9E9A]">
                            {{ s.childCount }} 个子任务
                          </span>
                        </div>
                      </div>
                      <div class="flex shrink-0 gap-1">
                        <button
                          class="rounded px-1.5 py-0.5 text-[10px] font-medium text-success-500 transition-colors hover:bg-success-50"
                          @click="handleAcceptSuggestion(s)"
                        >
                          采纳
                        </button>
                        <button
                          class="rounded px-1.5 py-0.5 text-[10px] font-medium text-[#9E9E9A] transition-colors hover:bg-surface-hover"
                          @click="handleRejectSuggestion(s)"
                        >
                          忽略
                        </button>
                      </div>
                    </div>

                    <!-- AI loading indicator -->
                    <div
                      v-if="currentSuggestionPanel.loading"
                      class="flex items-center gap-2 rounded-md bg-violet-50 px-2.5 py-2"
                    >
                      <svg class="h-3.5 w-3.5 animate-spin text-violet-500" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span class="text-xs text-violet-600">正在生成建议…</span>
                    </div>

                    <!-- Empty state after all dismissed -->
                    <p
                      v-if="!currentSuggestionPanel.loading && currentSuggestionPanel.suggestions.length === 0"
                      class="py-1 text-center text-xs text-[#9E9E9A]"
                    >
                      暂无内容
                    </p>
                  </div>
                </div>
              </div>

              <!-- Notes -->
              <div>
                <textarea
                  v-model="taskDraft.notes"
                  aria-label="备注"
                  class="w-full rounded-lg border border-surface-border px-3 py-2 text-sm text-[#6F6F6B] placeholder:text-[#9E9E9A] focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  rows="4"
                  placeholder="添加备注…"
                />
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="space-y-3 border-t border-surface-border px-4 py-3">
            <div class="flex items-center justify-between text-xs text-[#9E9E9A]">
              <span>所属清单：{{ getProjectName(taskDraft.projectId || 0) }}</span>
              <span>创建于 {{ new Date(selectedTask.createdAt || selectedTask.id).toLocaleDateString() }}</span>
            </div>
            <div class="flex items-center gap-2">
              <button
                class="flex-1 rounded px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
                :class="hasUnsavedChanges ? 'bg-primary-600 hover:bg-primary-700' : 'bg-surface-border cursor-not-allowed'"
                :disabled="!hasUnsavedChanges"
                @click="saveTaskDetail"
              >
                保存修改
              </button>
              <button
                class="rounded px-3 py-2 text-sm text-danger-400 hover:bg-danger-50 hover:text-danger-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger-500/40"
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
        class="pointer-events-auto fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-[#1C1C1A] px-4 py-3 text-sm text-white shadow-xl"
      >
        <div class="flex items-center gap-3">
          <span>任务“{{ pendingUndoDeletion.taskTitle }}”已删除</span>
          <button
            class="rounded border border-white/25 px-2 py-1 text-xs font-medium text-white hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            @click="undoDeleteTask"
          >
            撤销
          </button>
          <span class="text-xs text-[#9E9E9A]">{{ undoRemainingSeconds }}s</span>
        </div>
      </div>
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
        v-if="inlineNoticeMessage"
        :key="inlineNoticeToken"
        class="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-surface-border bg-white px-4 py-2.5 text-sm text-[#1C1C1A] shadow-xl"
      >
        {{ inlineNoticeMessage }}
      </div>
    </Transition>

    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-120 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="inlineConfirmState"
        class="fixed inset-0 z-50 flex items-center justify-center bg-[#1C1C1A]/30 px-4"
      >
        <div class="w-full max-w-md rounded-xl border border-surface-border bg-white shadow-2xl">
          <div class="border-b border-surface-border px-5 py-3 text-sm font-semibold text-[#1C1C1A]">确认操作</div>
          <div class="px-5 py-4 text-sm text-[#6F6F6B]">{{ inlineConfirmState.message }}</div>
          <div class="flex items-center justify-end gap-2 border-t border-surface-border px-5 py-3">
            <button
              class="rounded px-3 py-1.5 text-sm text-[#6F6F6B] hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
              @click="resolveInlineConfirm(false)"
            >
              取消
            </button>
            <button
              class="rounded bg-primary-600 px-3 py-1.5 text-sm text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
              @click="resolveInlineConfirm(true)"
            >
              确认
            </button>
          </div>
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
