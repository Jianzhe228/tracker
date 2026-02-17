import type { TaskItem } from '../../types/domain';
import { invokeCommand } from './invoke';

export function listTasks(): Promise<TaskItem[]> {
  return invokeCommand<TaskItem[]>('task_list');
}

export function createTask(task: TaskItem): Promise<TaskItem> {
  return invokeCommand<TaskItem>('task_create', { payload: task });
}

export function updateTask(payload: Record<string, unknown>): Promise<void> {
  return invokeCommand<void>('task_update', { payload });
}

export function deleteTask(id: number): Promise<void> {
  return invokeCommand<void>('task_delete', { id });
}
