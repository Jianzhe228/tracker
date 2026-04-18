import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import type {
  HistoryTemplateNode,
  ProjectItem,
  RecurringRuleItem,
  TaskItem,
  TaskStatus,
} from '../types/domain';
import {
  listTasks as listTasksCmd,
  createTask as createTaskCmd,
  updateTask as updateTaskCmd,
  deleteTask as deleteTaskCmd,
  restoreTask as restoreTaskCmd,
} from '../services/commands/task';
import { createProject as createProjectCmd, updateProject as updateProjectCmd, deleteProject as deleteProjectCmd } from '../services/commands/project';
import { historyGetTemplate } from '../services/commands/learning';
import { sendNotification } from '../services/notification';
import { recordTaskCreation } from '../services/commands/prediction';
import { extractKeywords } from '../services/suggestion/keywordExtractor';
import { useSettingsStore } from './settingsStore';
import { toDateKey } from '../utils/date';
import { INBOX_PROJECT_ID } from '../utils/constants';

const isTauri = '__TAURI_INTERNALS__' in window;

// Monotonic ID generator. Guarantees unique, strictly increasing ids even when
// multiple tasks are created within the same millisecond (e.g. batch copy).
let lastAssignedTaskId = 0;
export function nextLocalTaskId(): number {
  const now = Date.now();
  lastAssignedTaskId = now > lastAssignedTaskId ? now : lastAssignedTaskId + 1;
  return lastAssignedTaskId;
}

type PendingUndoDeletion = {
  taskId: number;
  taskTitle: string;
  expiresAt: number;
  removedTasks: TaskItem[];
  previousOrder: number[];
};

type ToggleTaskResult = {
  ok: boolean;
  reason?: 'not_found' | 'has_incomplete_subtasks' | 'sync_failed';
  taskId?: number;
  parentId?: number | null;
  shouldPromptCompleteParent?: boolean;
};

export const useTaskStore = defineStore('task', () => {
  const tasks = ref<TaskItem[]>([]);
  const projects = ref<ProjectItem[]>([]);
  const recurringRules = ref<Map<number, RecurringRuleItem>>(new Map());
  const pendingUndoDeletion = ref<PendingUndoDeletion | null>(null);
  const togglingTaskIds = ref<Set<number>>(new Set());

  let undoClearTimer: ReturnType<typeof setTimeout> | null = null;

  const todoCount = computed(() => tasks.value.filter((task) => task.parentId === null && task.status === 'todo').length);

  type TaskCreateOptions = Partial<Omit<TaskItem, 'id' | 'title' | 'status' | 'createdAt' | 'updatedAt'>> & {
    skipHistoryAutofill?: boolean;
    skipPredictionRecord?: boolean;
    forceHistoryAutofill?: boolean;
  };

  const historyAutofilledTaskIds = new Set<number>();

  function buildTask(title: string, options: TaskCreateOptions = {}): TaskItem {
    const now = new Date().toISOString();
    return {
      id: nextLocalTaskId(),
      title,
      status: 'todo',
      priority: options.priority ?? 0,
      projectId: options.projectId ?? null,
      parentId: options.parentId ?? null,
      dueAt: options.dueAt ?? null,
      startAt: options.startAt ?? null,
      reminderTime: options.reminderTime ?? null,
      completedAt: null,
      deletedAt: null,
      notes: options.notes ?? null,
      pomodoroCount: options.pomodoroCount ?? 1,
      pomodoroDuration: options.pomodoroDuration ?? (() => {
        const s = useSettingsStore();
        return s.timer.focusMinutes;
      })(),
      sortOrder: options.sortOrder ?? 0,
      recurringRuleId: options.recurringRuleId ?? null,
      rescheduledTo: options.rescheduledTo ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  function clearPendingUndoDeletion(): void {
    if (undoClearTimer) {
      clearTimeout(undoClearTimer);
      undoClearTimer = null;
    }
    pendingUndoDeletion.value = null;
  }

  function setPendingUndoDeletion(payload: PendingUndoDeletion): void {
    clearPendingUndoDeletion();
    pendingUndoDeletion.value = payload;

    const delay = Math.max(0, payload.expiresAt - Date.now());
    undoClearTimer = window.setTimeout(() => {
      pendingUndoDeletion.value = null;
      undoClearTimer = null;
    }, delay);
  }

  function collectTaskTreeIds(rootId: number): Set<number> {
    const idsToRemove = new Set<number>([rootId]);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const task of tasks.value) {
        if (task.parentId != null && idsToRemove.has(task.parentId) && !idsToRemove.has(task.id)) {
          idsToRemove.add(task.id);
          expanded = true;
        }
      }
    }
    return idsToRemove;
  }

  function loadFromData(rows: TaskItem[]): void {
    tasks.value = rows;
  }

  function loadProjectsFromData(rows: ProjectItem[]): void {
    projects.value = rows;
  }

  function loadRecurringRulesFromData(rows: RecurringRuleItem[]): void {
    const map = new Map<number, RecurringRuleItem>();
    for (const rule of rows) {
      map.set(rule.id, rule);
    }
    recurringRules.value = map;
  }

  function upsertRecurringRule(rule: RecurringRuleItem): void {
    recurringRules.value.set(rule.id, rule);
  }

  function removeRecurringRule(id: number): void {
    recurringRules.value.delete(id);
  }

  function getRecurringRule(id: number | null): RecurringRuleItem | null {
    if (id == null) return null;
    return recurringRules.value.get(id) ?? null;
  }

  async function syncTasksFromBackend(): Promise<void> {
    if (!isTauri) return;
    tasks.value = await listTasksCmd();
  }

  async function createTaskRecord(title: string, options: TaskCreateOptions = {}): Promise<TaskItem> {
    const task = buildTask(title, options);
    if (isTauri) {
      const created = await createTaskCmd(task);
      tasks.value = [created, ...tasks.value];
      if (!options.skipPredictionRecord) {
        // Record task creation for AI prediction analysis (fire-and-forget)
        void recordTaskCreation({
          taskTitle: title,
          projectId: options.projectId,
          createdAt: new Date().toISOString(),
          isRecurringInstance: options.recurringRuleId != null,
        }).catch((err) => console.warn('[taskStore] Failed to record task creation:', err));
      }
      return created;
    }
    tasks.value = [task, ...tasks.value];
    return task;
  }

  async function createTasksFromHistoryTemplate(
    parentTask: TaskItem,
    nodes: HistoryTemplateNode[],
  ): Promise<boolean> {
    let applied = false;

    for (const node of nodes) {
      const duplicate = tasks.value.some(
        (task) => task.parentId === parentTask.id && task.title === node.title,
      );
      if (duplicate) continue;

      const childTask = await addTask(node.title, {
        parentId: parentTask.id,
        projectId: parentTask.projectId,
        dueAt: parentTask.dueAt,
        skipPredictionRecord: true,
        forceHistoryAutofill: node.children.length === 0,
        skipHistoryAutofill: node.children.length > 0,
      });
      applied = true;

      if (node.children.length > 0) {
        await createTasksFromHistoryTemplate(childTask, node.children);
      }
    }

    return applied;
  }

  async function applyHistoryTemplate(task: TaskItem): Promise<boolean> {
    if (!isTauri) return false;

    const keywords = extractKeywords(task.title);
    if (keywords.length === 0) return false;

    try {
      const template = await historyGetTemplate(task.title, keywords, task.projectId, 2);
      if (template.length === 0) return false;
      return await createTasksFromHistoryTemplate(task, template);
    } catch (err) {
      console.warn('[taskStore] Failed to apply history template:', err);
      return false;
    }
  }

  async function addTask(title: string, options: TaskCreateOptions = {}): Promise<TaskItem> {
    const created = await createTaskRecord(title, options);

    const shouldApplyHistoryTemplate = !options.skipHistoryAutofill
      && (options.parentId == null || options.forceHistoryAutofill);

    if (shouldApplyHistoryTemplate) {
      const applied = await applyHistoryTemplate(created);
      if (applied && options.parentId == null) {
        historyAutofilledTaskIds.add(created.id);
      } else if (options.parentId == null) {
        historyAutofilledTaskIds.delete(created.id);
      }
    }

    return created;
  }

  function consumeHistoryAutofill(taskId: number): boolean {
    const hadAutofill = historyAutofilledTaskIds.has(taskId);
    historyAutofilledTaskIds.delete(taskId);
    return hadAutofill;
  }

  function getDirectSubtasks(parentId: number): TaskItem[] {
    return tasks.value.filter((task) => task.parentId === parentId);
  }

  function hasIncompleteDirectSubtasks(parentId: number): boolean {
    return getDirectSubtasks(parentId).some((task) => task.status !== 'done' && task.status !== 'cancelled');
  }

  function areAllDirectSubtasksDone(parentId: number): boolean {
    const subtasks = getDirectSubtasks(parentId);
    if (subtasks.length === 0) return false;
    return subtasks.every((task) => task.status === 'done' || task.status === 'cancelled');
  }

  async function toggleTask(id: number): Promise<ToggleTaskResult> {
    if (togglingTaskIds.value.has(id)) {
      return { ok: false, reason: 'sync_failed', taskId: id };
    }
    togglingTaskIds.value.add(id);
    const cleanup = () => { togglingTaskIds.value.delete(id); };
    const target = tasks.value.find((task) => task.id === id);
    if (!target) {
      cleanup();
      return {
        ok: false,
        reason: 'not_found',
      };
    }

    const snapshot = tasks.value.map((task) => ({
      id: task.id,
      status: task.status,
      completedAt: task.completedAt,
      updatedAt: task.updatedAt,
    }));

    const nextStatus = target.status === 'done' ? 'todo' : 'done';
    if (nextStatus === 'done' && hasIncompleteDirectSubtasks(target.id)) {
      cleanup();
      return {
        ok: false,
        reason: 'has_incomplete_subtasks',
        taskId: id,
      };
    }

    const now = new Date().toISOString();

    target.status = nextStatus;
    target.updatedAt = now;
    target.completedAt = nextStatus === 'done' ? now : null;

    if (target.parentId != null && nextStatus !== 'done') {
      // Propagate not-done status up the entire ancestor chain
      let currentId: number | null = target.parentId;
      while (currentId != null) {
        const ancestor = tasks.value.find((task) => task.id === currentId);
        if (!ancestor || ancestor.status !== 'done') break;
        ancestor.status = 'todo';
        ancestor.completedAt = null;
        ancestor.updatedAt = now;
        currentId = ancestor.parentId;
      }
    }

    const shouldPromptCompleteParent = target.parentId != null
      && nextStatus === 'done'
      && areAllDirectSubtasksDone(target.parentId);

    if (!isTauri) {
      cleanup();
      return {
        ok: true,
        taskId: id,
        parentId: target.parentId,
        shouldPromptCompleteParent,
      };
    }

    try {
      await updateTaskCmd({
        id,
        status: target.status,
        updatedAt: now,
        completedAt: target.completedAt,
      });
      cleanup();
      return {
        ok: true,
        taskId: id,
        parentId: target.parentId,
        shouldPromptCompleteParent,
      };
    } catch (error) {
      console.error(error);
      const snapshotById = new Map(snapshot.map((item) => [item.id, item]));
      for (const task of tasks.value) {
        const saved = snapshotById.get(task.id);
        if (!saved) continue;
        task.status = saved.status;
        task.completedAt = saved.completedAt;
        task.updatedAt = saved.updatedAt;
      }

      const message = typeof error === 'string'
        ? error
        : (error instanceof Error ? error.message : '');
      const reason = message.includes('unfinished subtasks')
        ? 'has_incomplete_subtasks'
        : 'sync_failed';

      cleanup();
      return {
        ok: false,
        reason,
        taskId: id,
      };
    }
  }

  async function updateTask(id: number, payload: Partial<Omit<TaskItem, 'id' | 'createdAt'>>): Promise<void> {
    const target = tasks.value.find((task) => task.id === id);
    if (!target) return;

    if (payload.status === 'done' && hasIncompleteDirectSubtasks(id)) {
      throw new Error('has_incomplete_subtasks');
    }

    const snapshot = tasks.value.map((task) => ({ ...task }));
    const now = new Date().toISOString();
    Object.assign(target, payload, { updatedAt: now });

    // cancel 级联：把整棵子树中仍为 todo 的子孙也标记 cancelled
    const cascadeCancelIds: number[] = [];
    if (payload.status === 'cancelled') {
      const subtreeIds = collectTaskTreeIds(id);
      for (const sid of subtreeIds) {
        if (sid === id) continue;
        const sub = tasks.value.find((t) => t.id === sid);
        if (sub && sub.status === 'todo') {
          sub.status = 'cancelled';
          sub.updatedAt = now;
          cascadeCancelIds.push(sid);
        }
      }
    }

    if (payload.status && payload.status !== 'done' && target.parentId != null) {
      let currentId: number | null = target.parentId;
      while (currentId != null) {
        const ancestor = tasks.value.find((task) => task.id === currentId);
        if (!ancestor || ancestor.status !== 'done') break;
        ancestor.status = 'todo';
        ancestor.completedAt = null;
        ancestor.updatedAt = now;
        currentId = ancestor.parentId;
      }
    }

    if (!isTauri) return;

    try {
      const dbPayload: Record<string, unknown> = { id, updatedAt: now };
      for (const [key, value] of Object.entries(payload)) {
        dbPayload[key] = value;
      }
      await updateTaskCmd(dbPayload);
      if (cascadeCancelIds.length > 0) {
        await Promise.all(
          cascadeCancelIds.map((cid) =>
            updateTaskCmd({ id: cid, status: 'cancelled', updatedAt: now })
          )
        );
      }
    } catch (error) {
      console.error(error);
      tasks.value = snapshot;
      throw error;
    }
  }

  async function removeTask(id: number): Promise<void> {
    const target = tasks.value.find((task) => task.id === id);
    if (!target) return;

    const idsToRemove = collectTaskTreeIds(id);
    const removedTasks = tasks.value
      .filter((task) => idsToRemove.has(task.id))
      .map((task) => ({ ...task }));
    const previousOrder = tasks.value.map((task) => task.id);

    if (isTauri) {
      await deleteTaskCmd(id);
    }

    tasks.value = tasks.value.filter((task) => !idsToRemove.has(task.id));

    setPendingUndoDeletion({
      taskId: id,
      taskTitle: target.title,
      expiresAt: Date.now() + 10_000,
      removedTasks,
      previousOrder,
    });
  }

  async function undoLastDeletion(): Promise<boolean> {
    const pending = pendingUndoDeletion.value;
    if (!pending) return false;

    if (Date.now() > pending.expiresAt) {
      clearPendingUndoDeletion();
      return false;
    }

    try {
      if (isTauri) {
        await restoreTaskCmd(pending.taskId);
        await syncTasksFromBackend();
      } else {
        const taskById = new Map<number, TaskItem>();
        for (const task of tasks.value) {
          taskById.set(task.id, task);
        }
        for (const task of pending.removedTasks) {
          taskById.set(task.id, task);
        }
        tasks.value = pending.previousOrder
          .map((id) => taskById.get(id))
          .filter((task): task is TaskItem => task != null);
      }

      clearPendingUndoDeletion();
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  type ReorderTasksOptions = {
    parentId?: number | null;
    status?: TaskStatus | null;
  };

  async function reorderTasks(taskIds: number[], options: ReorderTasksOptions = {}): Promise<boolean> {
    if (taskIds.length === 0) return true;
    if (new Set(taskIds).size !== taskIds.length) return false;

    const targetParentId = options.parentId ?? null;
    const targetStatus = options.status === undefined ? 'todo' : options.status;

    const taskById = new Map<number, TaskItem>(tasks.value.map((task) => [task.id, task]));
    const previousOrder = tasks.value.map((task) => task.id);
    const previousMeta = new Map<number, { sortOrder: number; updatedAt: string }>(
      tasks.value.map((task) => [task.id, { sortOrder: task.sortOrder, updatedAt: task.updatedAt }])
    );
    const restorePreviousState = (): void => {
      const taskById = new Map<number, TaskItem>();
      for (const task of tasks.value) {
        const snapshot = previousMeta.get(task.id);
        if (snapshot) {
          task.sortOrder = snapshot.sortOrder;
          task.updatedAt = snapshot.updatedAt;
        }
        taskById.set(task.id, task);
      }

      tasks.value = previousOrder
        .map((id) => taskById.get(id))
        .filter((task): task is TaskItem => task != null);
    };

    const orderedSubset: TaskItem[] = [];
    for (const id of taskIds) {
      const task = taskById.get(id);
      if (!task) {
        restorePreviousState();
        return false;
      }
      if (task.parentId !== targetParentId) {
        restorePreviousState();
        return false;
      }
      if (targetStatus != null && task.status !== targetStatus) {
        restorePreviousState();
        return false;
      }
      orderedSubset.push(task);
    }

    const orderedIdSet = new Set(orderedSubset.map((task) => task.id));
    const nextTasks: TaskItem[] = [];
    let subsetIndex = 0;
    for (const task of tasks.value) {
      if (orderedIdSet.has(task.id)) {
        const nextTask = orderedSubset[subsetIndex];
        if (!nextTask) {
          restorePreviousState();
          return false;
        }
        nextTasks.push(nextTask);
        subsetIndex += 1;
      } else {
        nextTasks.push(task);
      }
    }

    if (subsetIndex !== orderedSubset.length) {
      restorePreviousState();
      return false;
    }

    const now = new Date().toISOString();
    const changedTasks: TaskItem[] = [];

    const sortableTasks = nextTasks.filter((task) => {
      if (task.parentId !== targetParentId) return false;
      if (targetStatus != null && task.status !== targetStatus) return false;
      return true;
    });
    sortableTasks.forEach((task, index) => {
      const nextSortOrder = index + 1;
      const snapshot = previousMeta.get(task.id);
      task.sortOrder = nextSortOrder;
      if (snapshot && snapshot.sortOrder !== nextSortOrder) {
        task.updatedAt = now;
        changedTasks.push(task);
      }
    });

    tasks.value = nextTasks;

    if (isTauri && changedTasks.length > 0) {
      try {
        await Promise.all(
          changedTasks.map((task) => updateTaskCmd({
            id: task.id,
            sortOrder: task.sortOrder,
            updatedAt: task.updatedAt,
          }))
        );
      } catch (error) {
        console.error(error);
        restorePreviousState();
        return false;
      }
    }

    return true;
  }

  async function addProject(title: string, color?: string | null): Promise<void> {
    if (isTauri) {
      const project = await createProjectCmd({ title, color }).catch((err) => {
        console.error(err);
        return null;
      });
      if (project) {
        projects.value.push(project);
      }
    } else {
      const now = new Date().toISOString();
      projects.value.push({
        id: Date.now(),
        title,
        color: color ?? null,
        icon: null,
        parentId: null,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  async function updateProject(id: number, payload: { title?: string; color?: string | null; icon?: string | null }): Promise<void> {
    const target = projects.value.find((p) => p.id === id);
    if (!target) return;
    Object.assign(target, payload);
    if (isTauri) {
      await updateProjectCmd({ id, ...payload }).catch(console.error);
    }
  }

  async function removeProject(id: number): Promise<void> {
    projects.value = projects.value.filter((p) => p.id !== id);
    // Move tasks from deleted project to inbox - use map to trigger reactivity
    tasks.value = tasks.value.map((task) =>
      task.projectId === id ? { ...task, projectId: INBOX_PROJECT_ID } : task
    );
    if (isTauri) {
      await deleteProjectCmd(id).catch(console.error);
    }
  }

  // Deadline watcher — batches notifications to avoid spam
  const deadlineNotified = new Map<string, number>(); // key → timestamp
  let deadlineWatcherInterval: ReturnType<typeof setInterval> | null = null;

  /** Clear stale entries older than 24 hours */
  function pruneDeadlineNotified(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [key, ts] of deadlineNotified) {
      if (ts < cutoff) deadlineNotified.delete(key);
    }
  }

  function checkDeadlines(): void {
    const settingsStore = useSettingsStore();
    if (!settingsStore.notification.notifyDeadline) return;

    pruneDeadlineNotified();

    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;
    const ONE_DAY = 24 * ONE_HOUR;

    const urgentTasks: TaskItem[] = [];  // due within 1 hour
    const todayTasks: TaskItem[] = [];   // due within today

    for (const task of tasks.value) {
      if (!task.dueAt || task.status === 'done' || task.status === 'cancelled') continue;

      // dueAt is a date string like "2026-02-19", parse as end of day local time
      const dueDate = new Date(task.dueAt + 'T23:59:59');
      const diff = dueDate.getTime() - now;
      if (diff < 0) continue;

      if (diff <= ONE_HOUR) {
        const key = `${task.id}:1h`;
        if (!deadlineNotified.has(key)) {
          deadlineNotified.set(key, now);
          urgentTasks.push(task);
        }
      } else if (diff <= ONE_DAY) {
        const key = `${task.id}:1d`;
        if (!deadlineNotified.has(key)) {
          deadlineNotified.set(key, now);
          todayTasks.push(task);
        }
      }
    }

    // Send ONE batched notification per urgency level
    if (urgentTasks.length === 1) {
      sendNotification({
        type: 'deadline',
        title: '任务即将截止',
        body: `「${urgentTasks[0].title}」将在 1 小时内截止`,
        payload: JSON.stringify({ taskIds: urgentTasks.map(t => t.id) }),
      });
    } else if (urgentTasks.length > 1) {
      const names = urgentTasks.slice(0, 3).map(t => `「${t.title}」`).join('、');
      const suffix = urgentTasks.length > 3 ? ` 等 ${urgentTasks.length} 个任务` : '';
      sendNotification({
        type: 'deadline',
        title: '多个任务即将截止',
        body: `${names}${suffix}将在 1 小时内截止`,
        payload: JSON.stringify({ taskIds: urgentTasks.map(t => t.id) }),
      });
    }

    if (todayTasks.length === 1) {
      sendNotification({
        type: 'deadline',
        title: '任务即将截止',
        body: `「${todayTasks[0].title}」将在今天截止`,
        payload: JSON.stringify({ taskIds: todayTasks.map(t => t.id) }),
      });
    } else if (todayTasks.length > 1) {
      const names = todayTasks.slice(0, 3).map(t => `「${t.title}」`).join('、');
      const suffix = todayTasks.length > 3 ? ` 等 ${todayTasks.length} 个任务` : '';
      sendNotification({
        type: 'deadline',
        title: '今日截止提醒',
        body: `${names}${suffix}将在今天截止`,
        payload: JSON.stringify({ taskIds: todayTasks.map(t => t.id) }),
      });
    }
  }

  function startDeadlineWatcher(): void {
    if (deadlineWatcherInterval) return;
    // Delay the first check 5s so that freshly opened app doesn't flood with
    // notifications before UI/settings have fully hydrated.
    setTimeout(() => { if (deadlineWatcherInterval) checkDeadlines(); }, 5000);
    deadlineWatcherInterval = setInterval(checkDeadlines, 60_000);
  }

  function stopDeadlineWatcher(): void {
    if (!deadlineWatcherInterval) return;
    clearInterval(deadlineWatcherInterval);
    deadlineWatcherInterval = null;
  }

  /**
   * Copy a task to today without changing the original task status.
   * Used for both completed and incomplete tasks in "All" view.
   */
  async function copyTaskToToday(id: number): Promise<void> {
    const original = tasks.value.find((task) => task.id === id);
    if (!original) return;
    const today = new Date();
    const todayKey = toDateKey(today);

    // Clone the parent task to today
    const cloned = await addTask(original.title, {
      projectId: original.projectId,
      priority: original.priority,
      dueAt: todayKey,
      notes: original.notes,
      pomodoroCount: original.pomodoroCount,
      pomodoroDuration: original.pomodoroDuration,
      recurringRuleId: original.recurringRuleId,
      skipHistoryAutofill: true,
    });

    // Clone only incomplete subtasks — 已完成/已取消子任务属于历史，不复制
    const subtasks = tasks.value.filter(
      (task) => task.parentId === id && task.status !== 'done' && task.status !== 'cancelled'
    );
    for (const sub of subtasks) {
      await addTask(sub.title, {
        parentId: cloned.id,
        projectId: sub.projectId,
        priority: sub.priority,
        dueAt: todayKey,
        pomodoroCount: sub.pomodoroCount,
        pomodoroDuration: sub.pomodoroDuration,
        skipHistoryAutofill: true,
      });
    }
  }

  /**
   * Reschedule an incomplete task to today.
   * The original task will be marked as cancelled.
   * Used only for incomplete overdue tasks.
   */
  async function rescheduleToToday(id: number): Promise<void> {
    const original = tasks.value.find((task) => task.id === id);
    if (!original) return;
    const today = new Date();
    const todayKey = toDateKey(today);

    // Clone the parent task to today (original stays as historical record)
    const cloned = await addTask(original.title, {
      projectId: original.projectId,
      priority: original.priority,
      dueAt: todayKey,
      notes: original.notes,
      pomodoroCount: original.pomodoroCount,
      pomodoroDuration: original.pomodoroDuration,
      recurringRuleId: original.recurringRuleId,
      skipHistoryAutofill: true,
    });

    // Clone incomplete subtasks
    const subtasks = tasks.value.filter(
      (task) => task.parentId === id && task.status !== 'done' && task.status !== 'cancelled'
    );
    for (const sub of subtasks) {
      await addTask(sub.title, {
        parentId: cloned.id,
        projectId: sub.projectId,
        priority: sub.priority,
        dueAt: todayKey,
        pomodoroCount: sub.pomodoroCount,
        pomodoroDuration: sub.pomodoroDuration,
        skipHistoryAutofill: true,
      });
    }

    // Mark original as cancelled with reschedule record
    await updateTask(id, { status: 'cancelled' as TaskStatus, rescheduledTo: todayKey });
  }

  async function rescheduleOverdueToToday(ids: number[]): Promise<void> {
    await Promise.all(ids.map((id) => rescheduleToToday(id)));
  }

  async function copyTasksToToday(ids: number[]): Promise<void> {
    await Promise.all(ids.map((id) => copyTaskToToday(id)));
  }

  return {
    tasks,
    projects,
    recurringRules,
    pendingUndoDeletion,
    todoCount,
    loadFromData,
    loadProjectsFromData,
    loadRecurringRulesFromData,
    upsertRecurringRule,
    removeRecurringRule,
    getRecurringRule,
    syncTasksFromBackend,
    addTask,
    consumeHistoryAutofill,
    toggleTask,
    updateTask,
    removeTask,
    undoLastDeletion,
    reorderTasks,
    addProject,
    updateProject,
    removeProject,
    startDeadlineWatcher,
    stopDeadlineWatcher,
    rescheduleToToday,
    rescheduleOverdueToToday,
    copyTaskToToday,
    copyTasksToToday,
  };
});
