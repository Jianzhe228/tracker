import type {
  TaskItem,
  ArchiveCursor,
  TaskArchivePage,
  TaskStatusCounts,
} from '../../types/domain';
import { invokeCommand } from './invoke';

export function listTasks(options?: { limit?: number; offset?: number }): Promise<TaskItem[]> {
  return invokeCommand<TaskItem[]>('task_list', {
    limit: options?.limit ?? null,
    offset: options?.offset ?? null,
  });
}

/**
 * Lazy-load: load only the working set on app start.
 * Returns active (todo) tasks + recently completed/cancelled
 * tasks (last `archiveDays` days, default 30) + their full ancestor chain
 * and descendant subtree (so the task tree is never broken).
 */
export function listWorkingSet(archiveDays = 30): Promise<TaskItem[]> {
  return invokeCommand<TaskItem[]>('task_list_working_set', { archiveDays });
}

/**
 * Paginated archive of completed/cancelled tasks older than the working-set
 * window. Pass `cursor: null` for the first page; subsequent pages use
 * `nextCursor` from the previous response. `exhausted: true` means no more.
 */
export function listArchive(
  cursor: ArchiveCursor | null,
  limit = 50,
): Promise<TaskArchivePage> {
  return invokeCommand<TaskArchivePage>('task_list_archive', { cursor, limit });
}

/** GROUP BY status COUNT — used for sidebar / completedTasks badges. */
export function taskStatusCounts(): Promise<TaskStatusCounts> {
  return invokeCommand<TaskStatusCounts>('task_status_counts');
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

export function restoreTask(id: number): Promise<void> {
  return invokeCommand<void>('task_restore', { id });
}
