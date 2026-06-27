import type { TaskItem } from '../types/domain';
import { toDateKey } from './date';

// SQLite CURRENT_TIMESTAMP 形如 "2026-06-25 10:16:48"（UTC，无时区后缀）。
// 归一为本地 YYYY-MM-DD：无时区信息时补 'Z' 按 UTC 解析再转本地日期。
function timestampToDateKey(value: string | null): string | null {
  if (!value) return null;
  const iso = value.includes('T') ? value : value.replace(' ', 'T');
  const hasZone = /[zZ]|[+-]\d\d:?\d\d$/.test(iso);
  const date = new Date(hasZone ? iso : `${iso}Z`);
  if (Number.isNaN(date.getTime())) return null;
  return toDateKey(date);
}

// Check if a task is active on a given date:
// - exact match on dueAt or startAt
// - OR the date falls within [startAt, dueAt] range (for multi-day tasks);
//   当 startAt 缺省时，用创建日期当区间起点——"6/25 创建、6/30 截止"的
//   任务在 6/25~6/30 每天都视为活跃，与用户对"今日任务"的直觉一致。
export function isTaskActiveOnDate(task: TaskItem, dateKey: string): boolean {
  if (task.dueAt === dateKey || task.startAt === dateKey) return true;
  if (task.dueAt) {
    const start = task.startAt ?? timestampToDateKey(task.createdAt);
    if (start && start <= dateKey && dateKey <= task.dueAt) return true;
  }
  return false;
}

/**
 * Compute every task's *effective* pomodoro estimate in a single pass.
 *
 * A parent's estimate is the sum of its subtasks' effective estimates
 * (recursively), so the number shown on a parent always equals the sum of its
 * children. A leaf task uses its own `pomodoroCount` (min 1). Returns a Map
 * keyed by task id; ids absent from `tasks` simply won't be present.
 */
export function computeEffectivePomodoros(tasks: TaskItem[]): Map<number, number> {
  const childrenByParent = new Map<number, TaskItem[]>();
  const byId = new Map<number, TaskItem>();
  for (const task of tasks) {
    byId.set(task.id, task);
    if (task.parentId != null) {
      const siblings = childrenByParent.get(task.parentId);
      if (siblings) siblings.push(task);
      else childrenByParent.set(task.parentId, [task]);
    }
  }

  const memo = new Map<number, number>();
  const visiting = new Set<number>();

  function calc(id: number): number {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // defensive: break any accidental cycle
    visiting.add(id);

    const children = childrenByParent.get(id);
    let value: number;
    if (!children || children.length === 0) {
      value = Math.max(1, Math.round(byId.get(id)?.pomodoroCount ?? 1));
    } else {
      value = children.reduce((sum, child) => sum + calc(child.id), 0);
    }

    visiting.delete(id);
    memo.set(id, value);
    return value;
  }

  for (const task of tasks) calc(task.id);
  return memo;
}
