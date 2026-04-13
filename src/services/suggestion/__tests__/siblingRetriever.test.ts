/**
 * Tests for siblingRetriever relevance filtering.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

describe('siblingRetriever', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('only returns subtasks from similar parent tasks and excludes root tasks', async () => {
    const { useTaskStore } = await import('../../../stores/taskStore');
    const { retrieveSiblingCandidates } = await import('../retrievers/siblingRetriever');

    const store = useTaskStore();
    store.loadFromData([
      {
        id: 1,
        title: '四六级学习',
        status: 'todo',
        priority: 0,
        projectId: 1,
        parentId: null,
        dueAt: null,
        startAt: null,
        reminderTime: null,
        completedAt: null,
        deletedAt: null,
        notes: null,
        pomodoroCount: 1,
        pomodoroDuration: 25,
        sortOrder: 0,
        recurringRuleId: null,
        rescheduledTo: null,
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:00.000Z',
      },
      {
        id: 2,
        title: '完成一套模拟试题',
        status: 'todo',
        priority: 0,
        projectId: 1,
        parentId: 1,
        dueAt: null,
        startAt: null,
        reminderTime: null,
        completedAt: null,
        deletedAt: null,
        notes: null,
        pomodoroCount: 1,
        pomodoroDuration: 25,
        sortOrder: 0,
        recurringRuleId: null,
        rescheduledTo: null,
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:00.000Z',
      },
      {
        id: 3,
        title: '东京旅游',
        status: 'todo',
        priority: 0,
        projectId: 1,
        parentId: null,
        dueAt: null,
        startAt: null,
        reminderTime: null,
        completedAt: null,
        deletedAt: null,
        notes: null,
        pomodoroCount: 1,
        pomodoroDuration: 25,
        sortOrder: 0,
        recurringRuleId: null,
        rescheduledTo: null,
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:00.000Z',
      },
      {
        id: 4,
        title: '订酒店',
        status: 'todo',
        priority: 0,
        projectId: 1,
        parentId: 3,
        dueAt: null,
        startAt: null,
        reminderTime: null,
        completedAt: null,
        deletedAt: null,
        notes: null,
        pomodoroCount: 1,
        pomodoroDuration: 25,
        sortOrder: 0,
        recurringRuleId: null,
        rescheduledTo: null,
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:00.000Z',
      },
    ]);

    const candidates = await retrieveSiblingCandidates(1, 99, ['旅游']);

    expect(candidates.map((item) => item.title)).toEqual(['订酒店']);
  });
});
