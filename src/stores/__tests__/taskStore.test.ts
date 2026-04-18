/**
 * Tests for taskStore: copyTaskToToday, copyTasksToToday, rescheduleToToday
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type { TaskItem } from '../../types/domain';

// IMPORTANT: Set Tauri environment BEFORE any module imports
vi.hoisted(() => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, writable: true });
});

// Mock commands BEFORE importing taskStore
vi.mock('../../services/commands/task', () => ({
  listTasks: vi.fn(),
  createTask: vi.fn().mockImplementation((task) => Promise.resolve({ ...task, id: Math.floor(Math.random() * 10000) })),
  updateTask: vi.fn().mockResolvedValue(undefined),
  deleteTask: vi.fn().mockResolvedValue(undefined),
  restoreTask: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/commands/project', () => ({
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
}));

vi.mock('../../services/commands/learning', () => ({
  historyGetTemplate: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../services/notification', () => ({
  sendNotification: vi.fn(),
}));

vi.mock('../../services/commands/prediction', () => ({
  recordTaskCreation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/suggestion/keywordExtractor', () => ({
  extractKeywords: vi.fn(() => []),
}));

vi.mock('../settingsStore', () => ({
  useSettingsStore: vi.fn(() => ({
    pomodoroDuration: 25,
    showNotification: true,
  })),
}));

// Import AFTER mocks are set up
import { useTaskStore } from '../taskStore';
import * as taskCommands from '../../services/commands/task';

describe('taskStore - copyTaskToToday', () => {
  let taskStore: ReturnType<typeof useTaskStore>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T10:00:00'));
    setActivePinia(createPinia());
    taskStore = useTaskStore();

    // Clear all mocks
    vi.clearAllMocks();
    
    // Reset mock implementations
    vi.mocked(taskCommands.createTask).mockImplementation(
      (task) => Promise.resolve({ ...task, id: Math.floor(Math.random() * 10000) })
    );
    vi.mocked(taskCommands.updateTask).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TEST: copyTaskToToday - single task
  // ══════════════════════════════════════════════════════════════════════════

  describe('copyTaskToToday', () => {
    it('copies an incomplete task to today without changing original status', async () => {
      // Setup: original task from past
      const originalTask: TaskItem = {
        id: 1,
        title: 'Past task',
        status: 'todo',
        dueAt: '2026-04-10', // Past date
        priority: 'medium',
        notes: 'Some notes',
        pomodoroCount: 2,
        pomodoroDuration: 25,
        sortOrder: 0,
        projectId: null,
        parentId: null,
        recurringRuleId: null,
        rescheduledTo: null,
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-01T00:00:00Z',
      };

      taskStore.loadFromData([originalTask]);

      // Execute
      await taskStore.copyTaskToToday(1);

      // Verify: createTask was called with today's date
      expect(taskCommands.createTask).toHaveBeenCalledTimes(1);
      expect(taskCommands.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Past task',
          dueAt: '2026-04-15', // Today
          notes: 'Some notes',
          pomodoroCount: 2,
        })
      );

      // Verify: updateTask was NOT called (original task unchanged)
      expect(taskCommands.updateTask).not.toHaveBeenCalled();
    });

    it('copies a completed task to today', async () => {
      const completedTask: TaskItem = {
        id: 2,
        title: 'Completed task',
        status: 'done',
        dueAt: '2026-04-10',
        priority: 'high',
        notes: null,
        pomodoroCount: 3,
        pomodoroDuration: 25,
        sortOrder: 0,
        projectId: null,
        parentId: null,
        recurringRuleId: null,
        rescheduledTo: null,
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-10T00:00:00Z',
      };

      taskStore.loadFromData([completedTask]);

      await taskStore.copyTaskToToday(2);

      expect(taskCommands.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Completed task',
          dueAt: '2026-04-15',
        })
      );

      // Original task status remains unchanged
      expect(taskCommands.updateTask).not.toHaveBeenCalled();
    });

    it('copies a task with only its incomplete subtasks (B8)', async () => {
      const parentTask: TaskItem = {
        id: 10,
        title: 'Parent task',
        status: 'todo',
        dueAt: '2026-04-10',
        priority: 'medium',
        notes: null,
        pomodoroCount: 2,
        pomodoroDuration: 25,
        sortOrder: 0,
        projectId: null,
        parentId: null,
        recurringRuleId: null,
        rescheduledTo: null,
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-01T00:00:00Z',
      };

      const subtask1: TaskItem = {
        id: 11,
        title: 'Subtask 1',
        status: 'todo',
        dueAt: '2026-04-10',
        priority: 'medium',
        notes: null,
        pomodoroCount: 1,
        pomodoroDuration: 25,
        sortOrder: 0,
        projectId: null,
        parentId: 10,
        recurringRuleId: null,
        rescheduledTo: null,
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-01T00:00:00Z',
      };

      const subtask2: TaskItem = {
        id: 12,
        title: 'Subtask 2 (completed)',
        status: 'done',
        dueAt: '2026-04-10',
        priority: 'medium',
        notes: null,
        pomodoroCount: 1,
        pomodoroDuration: 25,
        sortOrder: 1,
        projectId: null,
        parentId: 10,
        recurringRuleId: null,
        rescheduledTo: null,
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-05T00:00:00Z',
      };

      taskStore.loadFromData([parentTask, subtask1, subtask2]);

      await taskStore.copyTaskToToday(10);

      // Parent + only the incomplete subtask (done subtask skipped)
      expect(taskCommands.createTask).toHaveBeenCalledTimes(2);

      expect(taskCommands.createTask).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          title: 'Parent task',
          dueAt: '2026-04-15',
        })
      );

      expect(taskCommands.createTask).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          title: 'Subtask 1',
          dueAt: '2026-04-15',
        })
      );

      const titles = vi.mocked(taskCommands.createTask).mock.calls.map(
        ([t]) => (t as TaskItem).title
      );
      expect(titles).not.toContain('Subtask 2 (completed)');
    });

    it('does nothing if task not found', async () => {
      taskStore.loadFromData([]);

      await taskStore.copyTaskToToday(999);

      expect(taskCommands.createTask).not.toHaveBeenCalled();
      expect(taskCommands.updateTask).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TEST: copyTasksToToday - batch operation
  // ══════════════════════════════════════════════════════════════════════════

  describe('copyTasksToToday', () => {
    it('copies multiple tasks to today in parallel', async () => {
      const task1: TaskItem = {
        id: 1,
        title: 'Task 1',
        status: 'todo',
        dueAt: '2026-04-10',
        priority: 'low',
        notes: null,
        pomodoroCount: 1,
        pomodoroDuration: 25,
        sortOrder: 0,
        projectId: null,
        parentId: null,
        recurringRuleId: null,
        rescheduledTo: null,
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-01T00:00:00Z',
      };

      const task2: TaskItem = {
        id: 2,
        title: 'Task 2',
        status: 'done',
        dueAt: '2026-04-10',
        priority: 'high',
        notes: null,
        pomodoroCount: 2,
        pomodoroDuration: 25,
        sortOrder: 1,
        projectId: null,
        parentId: null,
        recurringRuleId: null,
        rescheduledTo: null,
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-05T00:00:00Z',
      };

      taskStore.loadFromData([task1, task2]);

      await taskStore.copyTasksToToday([1, 2]);

      // Should call createTask for both tasks
      expect(taskCommands.createTask).toHaveBeenCalledTimes(2);
    });

    it('handles empty array gracefully', async () => {
      await taskStore.copyTasksToToday([]);

      expect(taskCommands.createTask).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TEST: rescheduleToToday - marks original as cancelled
  // ══════════════════════════════════════════════════════════════════════════

  describe('rescheduleToToday', () => {
    it('copies task to today AND marks original as cancelled', async () => {
      const originalTask: TaskItem = {
        id: 1,
        title: 'Overdue task',
        status: 'todo',
        dueAt: '2026-04-10',
        priority: 'medium',
        notes: 'Important',
        pomodoroCount: 2,
        pomodoroDuration: 25,
        sortOrder: 0,
        projectId: null,
        parentId: null,
        recurringRuleId: null,
        rescheduledTo: null,
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-01T00:00:00Z',
      };

      taskStore.loadFromData([originalTask]);

      await taskStore.rescheduleToToday(1);

      // Verify: new task created
      expect(taskCommands.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Overdue task',
          dueAt: '2026-04-15',
        })
      );

      // Verify: original task marked as cancelled
      expect(taskCommands.updateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 1,
          status: 'cancelled',
          rescheduledTo: '2026-04-15',
        })
      );
    });

    it('copies only incomplete subtasks when rescheduling', async () => {
      const parentTask: TaskItem = {
        id: 10,
        title: 'Parent',
        status: 'todo',
        dueAt: '2026-04-10',
        priority: 'medium',
        notes: null,
        pomodoroCount: 2,
        pomodoroDuration: 25,
        sortOrder: 0,
        projectId: null,
        parentId: null,
        recurringRuleId: null,
        rescheduledTo: null,
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-01T00:00:00Z',
      };

      const incompleteSubtask: TaskItem = {
        id: 11,
        title: 'Incomplete subtask',
        status: 'todo',
        dueAt: '2026-04-10',
        priority: 'medium',
        notes: null,
        pomodoroCount: 1,
        pomodoroDuration: 25,
        sortOrder: 0,
        projectId: null,
        parentId: 10,
        recurringRuleId: null,
        rescheduledTo: null,
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-01T00:00:00Z',
      };

      const completedSubtask: TaskItem = {
        id: 12,
        title: 'Completed subtask',
        status: 'done',
        dueAt: '2026-04-10',
        priority: 'medium',
        notes: null,
        pomodoroCount: 1,
        pomodoroDuration: 25,
        sortOrder: 1,
        projectId: null,
        parentId: 10,
        recurringRuleId: null,
        rescheduledTo: null,
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-05T00:00:00Z',
      };

      const cancelledSubtask: TaskItem = {
        id: 13,
        title: 'Cancelled subtask',
        status: 'cancelled',
        dueAt: '2026-04-10',
        priority: 'medium',
        notes: null,
        pomodoroCount: 1,
        pomodoroDuration: 25,
        sortOrder: 2,
        projectId: null,
        parentId: 10,
        recurringRuleId: null,
        rescheduledTo: null,
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-05T00:00:00Z',
      };

      taskStore.loadFromData([parentTask, incompleteSubtask, completedSubtask, cancelledSubtask]);

      await taskStore.rescheduleToToday(10);

      // Only 2 calls: parent + incomplete subtask
      expect(taskCommands.createTask).toHaveBeenCalledTimes(2);

      // First call: parent task
      expect(taskCommands.createTask).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          title: 'Parent',
        })
      );

      // Second call: only incomplete subtask
      expect(taskCommands.createTask).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          title: 'Incomplete subtask',
        })
      );

      // Completed and cancelled subtasks are NOT copied
    });

    it('does nothing if task not found', async () => {
      taskStore.loadFromData([]);

      await taskStore.rescheduleToToday(999);

      expect(taskCommands.createTask).not.toHaveBeenCalled();
      expect(taskCommands.updateTask).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TEST: rescheduleOverdueToToday
  // ══════════════════════════════════════════════════════════════════════════

  describe('rescheduleOverdueToToday', () => {
    it('reschedules multiple tasks in parallel', async () => {
      const task1: TaskItem = {
        id: 1,
        title: 'Task 1',
        status: 'todo',
        dueAt: '2026-04-10',
        priority: 'low',
        notes: null,
        pomodoroCount: 1,
        pomodoroDuration: 25,
        sortOrder: 0,
        projectId: null,
        parentId: null,
        recurringRuleId: null,
        rescheduledTo: null,
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-01T00:00:00Z',
      };

      const task2: TaskItem = {
        id: 2,
        title: 'Task 2',
        status: 'todo',
        dueAt: '2026-04-09',
        priority: 'medium',
        notes: null,
        pomodoroCount: 1,
        pomodoroDuration: 25,
        sortOrder: 1,
        projectId: null,
        parentId: null,
        recurringRuleId: null,
        rescheduledTo: null,
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-01T00:00:00Z',
      };

      taskStore.loadFromData([task1, task2]);

      await taskStore.rescheduleOverdueToToday([1, 2]);

      // Both tasks should be rescheduled
      expect(taskCommands.createTask).toHaveBeenCalledTimes(2);
      expect(taskCommands.updateTask).toHaveBeenCalledTimes(2);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TEST: Difference between copyTaskToToday and rescheduleToToday
  // ══════════════════════════════════════════════════════════════════════════

  describe('behavior difference: copy vs reschedule', () => {
    it('copyTaskToToday leaves original task unchanged', async () => {
      const originalTask: TaskItem = {
        id: 1,
        title: 'Original',
        status: 'todo',
        dueAt: '2026-04-10',
        priority: 'medium',
        notes: null,
        pomodoroCount: 1,
        pomodoroDuration: 25,
        sortOrder: 0,
        projectId: null,
        parentId: null,
        recurringRuleId: null,
        rescheduledTo: null,
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-01T00:00:00Z',
      };

      taskStore.loadFromData([originalTask]);

      await taskStore.copyTaskToToday(1);

      // Original task is NOT updated
      expect(taskCommands.updateTask).not.toHaveBeenCalled();
    });

    it('rescheduleToToday marks original as cancelled', async () => {
      const originalTask: TaskItem = {
        id: 1,
        title: 'Original',
        status: 'todo',
        dueAt: '2026-04-10',
        priority: 'medium',
        notes: null,
        pomodoroCount: 1,
        pomodoroDuration: 25,
        sortOrder: 0,
        projectId: null,
        parentId: null,
        recurringRuleId: null,
        rescheduledTo: null,
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-01T00:00:00Z',
      };

      taskStore.loadFromData([originalTask]);

      await taskStore.rescheduleToToday(1);

      // Original task IS updated to cancelled
      expect(taskCommands.updateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 1,
          status: 'cancelled',
          rescheduledTo: '2026-04-15',
        })
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TEST: monotonic id generator — prevents PK collision in batch copy
  // ══════════════════════════════════════════════════════════════════════════

  describe('nextLocalTaskId', () => {
    it('returns unique ids when called repeatedly within the same millisecond', async () => {
      const { nextLocalTaskId } = await import('../taskStore');
      // Fake timers frozen: Date.now() returns same value for all calls
      const ids = new Set<number>();
      for (let i = 0; i < 50; i++) ids.add(nextLocalTaskId());
      expect(ids.size).toBe(50);
    });

    it('produces strictly increasing ids', async () => {
      const { nextLocalTaskId } = await import('../taskStore');
      const ids = Array.from({ length: 20 }, () => nextLocalTaskId());
      for (let i = 1; i < ids.length; i++) {
        expect(ids[i]).toBeGreaterThan(ids[i - 1]);
      }
    });
  });

  describe('copyTasksToToday — id collision regression', () => {
    it('assigns unique ids to parent + all subtasks when created in the same ms', async () => {
      // Echo-back mock: backend returns exactly what frontend sent (exposes PK collisions)
      vi.mocked(taskCommands.createTask).mockImplementation((task) => Promise.resolve(task));

      const parent: TaskItem = {
        id: 100,
        title: 'Parent',
        status: 'todo',
        dueAt: '2026-04-10',
        priority: 'medium',
        notes: null,
        pomodoroCount: 1,
        pomodoroDuration: 25,
        sortOrder: 0,
        projectId: null,
        parentId: null,
        recurringRuleId: null,
        rescheduledTo: null,
        createdAt: '2026-04-10T00:00:00Z',
        updatedAt: '2026-04-10T00:00:00Z',
      };
      const makeSub = (id: number, title: string): TaskItem => ({
        ...parent,
        id,
        title,
        parentId: 100,
      });
      taskStore.loadFromData([
        parent,
        makeSub(101, 'sub-1'),
        makeSub(102, 'sub-2'),
        makeSub(103, 'sub-3'),
      ]);

      await taskStore.copyTaskToToday(100);

      // 1 parent + 3 subtasks = 4 createTask calls
      expect(taskCommands.createTask).toHaveBeenCalledTimes(4);
      const createdIds = vi.mocked(taskCommands.createTask).mock.calls.map(
        ([t]) => (t as TaskItem).id
      );
      expect(new Set(createdIds).size).toBe(4); // all unique
    });

    it('assigns unique ids when batch-copying multiple parents concurrently', async () => {
      vi.mocked(taskCommands.createTask).mockImplementation((task) => Promise.resolve(task));

      const makeTask = (id: number): TaskItem => ({
        id,
        title: `task-${id}`,
        status: 'todo',
        dueAt: '2026-04-10',
        priority: 'medium',
        notes: null,
        pomodoroCount: 1,
        pomodoroDuration: 25,
        sortOrder: 0,
        projectId: null,
        parentId: null,
        recurringRuleId: null,
        rescheduledTo: null,
        createdAt: '2026-04-10T00:00:00Z',
        updatedAt: '2026-04-10T00:00:00Z',
      });
      const originals = [1, 2, 3, 4, 5].map(makeTask);
      taskStore.loadFromData(originals);

      await taskStore.copyTasksToToday(originals.map((t) => t.id));

      expect(taskCommands.createTask).toHaveBeenCalledTimes(5);
      const createdIds = vi.mocked(taskCommands.createTask).mock.calls.map(
        ([t]) => (t as TaskItem).id
      );
      expect(new Set(createdIds).size).toBe(5);
    });
  });

  describe('toggleTask — concurrent toggles across different tasks', () => {
    it('allows toggling two different tasks in parallel without sync_failed', async () => {
      const makeTask = (id: number): TaskItem => ({
        id,
        title: `task-${id}`,
        status: 'todo',
        dueAt: '2026-04-15',
        priority: 'medium',
        notes: null,
        pomodoroCount: 1,
        pomodoroDuration: 25,
        sortOrder: 0,
        projectId: null,
        parentId: null,
        recurringRuleId: null,
        rescheduledTo: null,
        createdAt: '2026-04-15T00:00:00Z',
        updatedAt: '2026-04-15T00:00:00Z',
      });
      taskStore.loadFromData([makeTask(101), makeTask(102)]);

      // Simulate backend delay so both toggles are in-flight concurrently
      let resolveA!: () => void;
      let resolveB!: () => void;
      vi.mocked(taskCommands.updateTask)
        .mockImplementationOnce(() => new Promise<void>((r) => { resolveA = r; }))
        .mockImplementationOnce(() => new Promise<void>((r) => { resolveB = r; }));

      const pA = taskStore.toggleTask(101);
      const pB = taskStore.toggleTask(102);

      resolveA();
      resolveB();
      const [resA, resB] = await Promise.all([pA, pB]);

      expect(resA.ok).toBe(true);
      expect(resB.ok).toBe(true);
    });

    it('rejects duplicate in-flight toggle of the same task', async () => {
      const makeTask = (id: number): TaskItem => ({
        id,
        title: `task-${id}`,
        status: 'todo',
        dueAt: '2026-04-15',
        priority: 'medium',
        notes: null,
        pomodoroCount: 1,
        pomodoroDuration: 25,
        sortOrder: 0,
        projectId: null,
        parentId: null,
        recurringRuleId: null,
        rescheduledTo: null,
        createdAt: '2026-04-15T00:00:00Z',
        updatedAt: '2026-04-15T00:00:00Z',
      });
      taskStore.loadFromData([makeTask(201)]);

      let resolveOnce!: () => void;
      vi.mocked(taskCommands.updateTask)
        .mockImplementationOnce(() => new Promise<void>((r) => { resolveOnce = r; }));

      const pFirst = taskStore.toggleTask(201);
      const second = await taskStore.toggleTask(201);

      expect(second.ok).toBe(false);
      expect(second.reason).toBe('sync_failed');

      resolveOnce();
      const first = await pFirst;
      expect(first.ok).toBe(true);
    });
  });
});
