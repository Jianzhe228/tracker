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
