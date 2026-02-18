import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import type { TaskItem, ProjectItem, RecurringRuleItem } from '../types/domain';
import {
  listTasks as listTasksCmd,
  createTask as createTaskCmd,
  updateTask as updateTaskCmd,
  deleteTask as deleteTaskCmd,
  restoreTask as restoreTaskCmd,
} from '../services/commands/task';
import { createProject as createProjectCmd, updateProject as updateProjectCmd, deleteProject as deleteProjectCmd } from '../services/commands/project';

const isTauri = '__TAURI_INTERNALS__' in window;

type PendingUndoDeletion = {
  taskId: number;
  taskTitle: string;
  expiresAt: number;
  removedTasks: TaskItem[];
  previousOrder: number[];
};

export const useTaskStore = defineStore('task', () => {
  const tasks = ref<TaskItem[]>([]);
  const projects = ref<ProjectItem[]>([]);
  const recurringRules = ref<Map<number, RecurringRuleItem>>(new Map());
  const pendingUndoDeletion = ref<PendingUndoDeletion | null>(null);

  let undoClearTimer: ReturnType<typeof setTimeout> | null = null;

  const todoCount = computed(() => tasks.value.filter((task) => task.parentId === null && task.status === 'todo').length);

  type TaskCreateOptions = Partial<Omit<TaskItem, 'id' | 'title' | 'status' | 'createdAt' | 'updatedAt'>>;

  function buildTask(title: string, options: TaskCreateOptions = {}): TaskItem {
    const now = new Date().toISOString();
    return {
      id: Date.now(),
      title,
      status: 'todo',
      priority: options.priority ?? 0,
      projectId: options.projectId ?? null,
      parentId: options.parentId ?? null,
      dueAt: options.dueAt ?? null,
      reminderTime: options.reminderTime ?? null,
      completedAt: null,
      deletedAt: null,
      notes: options.notes ?? null,
      pomodoroCount: options.pomodoroCount ?? 1,
      pomodoroDuration: options.pomodoroDuration ?? 25,
      sortOrder: options.sortOrder ?? 0,
      recurringRuleId: options.recurringRuleId ?? null,
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

  async function addTask(title: string, options: TaskCreateOptions = {}): Promise<void> {
    const task = buildTask(title, options);
    if (isTauri) {
      const created = await createTaskCmd(task);
      tasks.value.unshift(created);
      return;
    }
    tasks.value.unshift(task);
  }

  function cascadeComplete(parentId: number, now: string): void {
    for (const task of tasks.value) {
      if (task.parentId === parentId && task.status !== 'done' && task.status !== 'cancelled') {
        task.status = 'done';
        task.completedAt = now;
        task.updatedAt = now;
        cascadeComplete(task.id, now);
      }
    }
  }

  async function toggleTask(id: number): Promise<boolean> {
    const target = tasks.value.find((task) => task.id === id);
    if (!target) return false;

    const snapshot = tasks.value.map((task) => ({
      id: task.id,
      status: task.status,
      completedAt: task.completedAt,
      updatedAt: task.updatedAt,
    }));

    const now = new Date().toISOString();
    const wasTodo = target.status === 'todo';
    target.status = wasTodo ? 'done' : 'todo';
    target.updatedAt = now;
    target.completedAt = wasTodo ? now : null;
    if (wasTodo) {
      cascadeComplete(id, now);
    }

    if (!isTauri) return true;

    try {
      await updateTaskCmd({
        id,
        status: target.status,
        updatedAt: now,
        completedAt: target.completedAt,
      });
      return true;
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
      return false;
    }
  }

  async function updateTask(id: number, payload: Partial<Omit<TaskItem, 'id' | 'createdAt'>>): Promise<void> {
    const target = tasks.value.find((task) => task.id === id);
    if (!target) return;

    const snapshot = tasks.value.map((task) => ({ ...task }));
    const now = new Date().toISOString();
    Object.assign(target, payload, { updatedAt: now });
    if (payload.status === 'done') {
      cascadeComplete(id, now);
    }

    if (!isTauri) return;

    try {
      const dbPayload: Record<string, unknown> = { id, updatedAt: now };
      for (const [key, value] of Object.entries(payload)) {
        dbPayload[key] = value;
      }
      await updateTaskCmd(dbPayload);
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

  async function reorderTasks(taskIds: number[]): Promise<boolean> {
    if (taskIds.length === 0) return true;
    if (new Set(taskIds).size !== taskIds.length) return false;

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

    const sortableTasks = nextTasks.filter((task) => task.parentId === null && task.status === 'todo');
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
    // Move tasks from deleted project to inbox (id=1)
    for (const task of tasks.value) {
      if (task.projectId === id) {
        task.projectId = 1;
      }
    }
    if (isTauri) {
      await deleteProjectCmd(id).catch(console.error);
    }
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
    toggleTask,
    updateTask,
    removeTask,
    undoLastDeletion,
    reorderTasks,
    addProject,
    updateProject,
    removeProject,
  };
});
