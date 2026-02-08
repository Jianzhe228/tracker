import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import type { TaskItem } from '../types/domain';

export const useTaskStore = defineStore('task', () => {
  const tasks = ref<TaskItem[]>([]);

  const todoCount = computed(() => tasks.value.filter((task) => task.status === 'todo').length);

  type TaskCreateOptions = Partial<Omit<TaskItem, 'id' | 'title' | 'status' | 'createdAt' | 'updatedAt'>>;

  function createTask(title: string, options: TaskCreateOptions = {}): TaskItem {
    const now = new Date().toISOString();
    return {
      id: Date.now(),
      title,
      status: 'todo',
      pomodoroCount: options.pomodoroCount ?? 1,
      dueDate: options.dueDate ?? null,
      listId: options.listId ?? 'inbox',
      reminderAt: options.reminderAt ?? null,
      notes: options.notes ?? '',
      subtasks: options.subtasks ?? [],
      createdAt: now,
      updatedAt: now
    };
  }

  function addTask(title: string, options: TaskCreateOptions = {}): void {
    tasks.value.unshift(createTask(title, options));
  }

  function toggleTask(id: number): void {
    const target = tasks.value.find((task) => task.id === id);
    if (!target) return;
    target.status = target.status === 'todo' ? 'done' : 'todo';
    target.updatedAt = new Date().toISOString();
  }

  function updateTask(id: number, payload: Partial<Omit<TaskItem, 'id' | 'createdAt'>>): void {
    const target = tasks.value.find((task) => task.id === id);
    if (!target) return;
    Object.assign(target, payload, { updatedAt: new Date().toISOString() });
  }

  return {
    tasks,
    todoCount,
    addTask,
    toggleTask,
    updateTask
  };
});
