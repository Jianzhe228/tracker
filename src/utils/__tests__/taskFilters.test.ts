import { describe, it, expect } from 'vitest';
import { isTaskActiveOnDate } from '../taskFilters';
import type { TaskItem } from '../../types/domain';

function makeTask(overrides: Partial<TaskItem>): TaskItem {
  return {
    id: 1,
    title: 'T',
    status: 'todo',
    priority: 'medium',
    projectId: 1,
    parentId: null,
    dueAt: null,
    startAt: null,
    reminderTime: null,
    completedAt: null,
    deletedAt: null,
    notes: null,
    pomodoroCount: 0,
    pomodoroDuration: 25,
    sortOrder: 0,
    recurringRuleId: null,
    rescheduledTo: null,
    createdAt: '2026-06-25 02:00:00',
    updatedAt: '2026-06-25 02:00:00',
    ...overrides,
  };
}

describe('isTaskActiveOnDate', () => {
  it('截止日正好是当天 → 活跃', () => {
    expect(isTaskActiveOnDate(makeTask({ dueAt: '2026-06-25' }), '2026-06-25')).toBe(true);
  });

  it('开始日正好是当天 → 活跃', () => {
    expect(isTaskActiveOnDate(makeTask({ startAt: '2026-06-25' }), '2026-06-25')).toBe(true);
  });

  it('显式 [开始日, 截止日] 区间含当天 → 活跃', () => {
    const task = makeTask({ startAt: '2026-06-20', dueAt: '2026-06-30' });
    expect(isTaskActiveOnDate(task, '2026-06-27')).toBe(true);
  });

  it('startAt 缺省时用创建日期当区间起点：创建 6/25、截止 6/30，6/27 仍活跃', () => {
    const task = makeTask({ startAt: null, dueAt: '2026-06-30', createdAt: '2026-06-25 02:00:00' });
    expect(isTaskActiveOnDate(task, '2026-06-27')).toBe(true);
    expect(isTaskActiveOnDate(task, '2026-06-25')).toBe(true);
    expect(isTaskActiveOnDate(task, '2026-06-30')).toBe(true);
  });

  it('当天早于创建日 → 不活跃', () => {
    const task = makeTask({ startAt: null, dueAt: '2026-06-30', createdAt: '2026-06-25 02:00:00' });
    expect(isTaskActiveOnDate(task, '2026-06-24')).toBe(false);
  });

  it('逾期任务（当天晚于截止日）→ 不活跃', () => {
    const task = makeTask({ startAt: null, dueAt: '2026-06-20', createdAt: '2026-06-15 02:00:00' });
    expect(isTaskActiveOnDate(task, '2026-06-25')).toBe(false);
  });

  it('无截止日 → 不进入区间判断，仅精确匹配', () => {
    const task = makeTask({ startAt: null, dueAt: null });
    expect(isTaskActiveOnDate(task, '2026-06-25')).toBe(false);
  });
});
