import type { TaskItem } from '../types/domain';

// Check if a task is active on a given date:
// - exact match on dueAt or startAt
// - OR the date falls within [startAt, dueAt] range (for multi-day tasks)
export function isTaskActiveOnDate(task: TaskItem, dateKey: string): boolean {
  if (task.dueAt === dateKey || task.startAt === dateKey) return true;
  if (task.startAt && task.dueAt && task.startAt <= dateKey && dateKey <= task.dueAt) return true;
  return false;
}
