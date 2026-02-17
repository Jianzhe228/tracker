import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import type { TaskItem, ProjectItem } from '../types/domain';
import { createTask as createTaskCmd, updateTask as updateTaskCmd, deleteTask as deleteTaskCmd } from '../services/commands/task';
import { createProject as createProjectCmd, updateProject as updateProjectCmd, deleteProject as deleteProjectCmd } from '../services/commands/project';

const isTauri = '__TAURI_INTERNALS__' in window;

export const useTaskStore = defineStore('task', () => {
  const tasks = ref<TaskItem[]>([]);
  const projects = ref<ProjectItem[]>([]);

  const todoCount = computed(() => tasks.value.filter((task) => task.status === 'todo').length);

  type TaskCreateOptions = Partial<Omit<TaskItem, 'id' | 'title' | 'status' | 'createdAt' | 'updatedAt'>>;

  function buildTask(title: string, options: TaskCreateOptions = {}): TaskItem {
    const now = new Date().toISOString();
    return {
      id: Date.now(),
      title,
      description: options.description ?? null,
      status: 'todo',
      priority: options.priority ?? 0,
      projectId: options.projectId ?? null,
      parentId: options.parentId ?? null,
      dueAt: options.dueAt ?? null,
      reminderTime: options.reminderTime ?? null,
      completedAt: null,
      deletedAt: null,
      isRecurring: options.isRecurring ?? false,
      repeatRule: options.repeatRule ?? null,
      notes: options.notes ?? null,
      pomodoroCount: options.pomodoroCount ?? 1,
      pomodoroDuration: options.pomodoroDuration ?? 25,
      sortOrder: options.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now
    };
  }

  function loadFromData(rows: TaskItem[]): void {
    tasks.value = rows;
  }

  function loadProjectsFromData(rows: ProjectItem[]): void {
    projects.value = rows;
  }

  async function addTask(title: string, options: TaskCreateOptions = {}): Promise<void> {
    const task = buildTask(title, options);
    tasks.value.unshift(task);
    if (isTauri) {
      await createTaskCmd(task).catch(console.error);
    }
  }

  async function toggleTask(id: number): Promise<void> {
    const target = tasks.value.find((task) => task.id === id);
    if (!target) return;
    const now = new Date().toISOString();
    const wasTodo = target.status === 'todo';
    target.status = wasTodo ? 'done' : 'todo';
    target.updatedAt = now;
    target.completedAt = wasTodo ? now : null;
    if (isTauri) {
      await updateTaskCmd({
        id,
        status: target.status,
        updatedAt: now,
        completedAt: target.completedAt,
      }).catch(console.error);
    }
  }

  async function updateTask(id: number, payload: Partial<Omit<TaskItem, 'id' | 'createdAt'>>): Promise<void> {
    const target = tasks.value.find((task) => task.id === id);
    if (!target) return;
    const now = new Date().toISOString();
    Object.assign(target, payload, { updatedAt: now });
    if (isTauri) {
      const dbPayload: Record<string, unknown> = { id, updatedAt: now };
      for (const [key, value] of Object.entries(payload)) {
        dbPayload[key] = value;
      }
      await updateTaskCmd(dbPayload).catch(console.error);
    }
  }

  async function removeTask(id: number): Promise<void> {
    tasks.value = tasks.value.filter((task) => task.id !== id);
    if (isTauri) {
      await deleteTaskCmd(id).catch(console.error);
    }
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
    todoCount,
    loadFromData,
    loadProjectsFromData,
    addTask,
    toggleTask,
    updateTask,
    removeTask,
    addProject,
    updateProject,
    removeProject,
  };
});
