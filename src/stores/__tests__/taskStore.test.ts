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

    it('copies a task with all its subtasks', async () => {
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

      // Verify: createTask called 3 times (parent + 2 subtasks)
      expect(taskCommands.createTask).toHaveBeenCalledTimes(3);

      // Parent task call
      expect(taskCommands.createTask).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          title: 'Parent task',
          dueAt: '2026-04-15',
        })
      );

      // Subtask 1 call
      expect(taskCommands.createTask).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          title: 'Subtask 1',
          dueAt: '2026-04-15',
        })
      );

      // Subtask 2 call (completed subtask is also copied)
      expect(taskCommands.createTask).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          title: 'Subtask 2 (completed)',
          dueAt: '2026-04-15',
        })
      );
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
});
