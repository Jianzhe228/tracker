/**
 * Tests for actionExecutor.ts — AI action dispatch to store operations.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AiAction } from '../types';
import type { ActionExecutorTaskStore } from '../actionExecutor';

/* ---------- mocks ---------- */

vi.mock('../../commands/notification', () => ({
  createNotification: vi.fn().mockResolvedValue(1),
}));

import { createNotification } from '../../commands/notification';
import { executeAction } from '../actionExecutor';

/* ---------- helpers ---------- */

function makeMockStore(
  tasks: ActionExecutorTaskStore['tasks'] = [],
): ActionExecutorTaskStore {
  return {
    tasks,
    addTask: vi.fn().mockResolvedValue(undefined),
    updateTask: vi.fn().mockResolvedValue(undefined),
  };
}

function makeAction(type: string, params: Record<string, unknown> = {}): AiAction {
  return { type, params, status: 'approved' };
}

/* ---------- setup ---------- */

beforeEach(() => {
  vi.clearAllMocks();
});

/* ---------- tests ---------- */

describe('executeAction', () => {
  describe('create_subtask', () => {
    it('creates subtask with parentId and inherits projectId/dueAt from parent', async () => {
      const store = makeMockStore([
        { id: 10, projectId: 5, dueAt: '2026-04-01' },
      ]);
      const action = makeAction('create_subtask', { title: 'Write tests' });
      const context = { taskId: 10 };

      await executeAction(action, context, store);

      expect(store.addTask).toHaveBeenCalledWith('Write tests', {
        parentId: 10,
        projectId: 5,
        dueAt: '2026-04-01',
      });
    });

    it('handles missing parentId gracefully', async () => {
      const store = makeMockStore();
      const action = makeAction('create_subtask', { title: 'Orphan subtask' });
      const context = {};

      await executeAction(action, context, store);

      expect(store.addTask).toHaveBeenCalledWith('Orphan subtask', {
        parentId: null,
        projectId: null,
        dueAt: null,
      });
    });

    it('handles parentId not found in store tasks', async () => {
      const store = makeMockStore([
        { id: 99, projectId: 2, dueAt: '2026-05-01' },
      ]);
      const action = makeAction('create_subtask', { title: 'Sub' });
      const context = { taskId: 42 };

      await executeAction(action, context, store);

      expect(store.addTask).toHaveBeenCalledWith('Sub', {
        parentId: 42,
        projectId: null,
        dueAt: null,
      });
    });

    it('uses empty string when title param is missing', async () => {
      const store = makeMockStore();
      const action = makeAction('create_subtask', {});
      const context = {};

      await executeAction(action, context, store);

      expect(store.addTask).toHaveBeenCalledWith('', {
        parentId: null,
        projectId: null,
        dueAt: null,
      });
    });
  });

  describe('create_task', () => {
    it('creates task with projectId and dueAt from params', async () => {
      const store = makeMockStore();
      const action = makeAction('create_task', {
        title: 'New feature',
        projectId: 3,
        dueAt: '2026-06-15',
      });

      await executeAction(action, {}, store);

      expect(store.addTask).toHaveBeenCalledWith('New feature', {
        projectId: 3,
        dueAt: '2026-06-15',
      });
    });

    it('defaults projectId and dueAt to null when not provided', async () => {
      const store = makeMockStore();
      const action = makeAction('create_task', { title: 'Simple task' });

      await executeAction(action, {}, store);

      expect(store.addTask).toHaveBeenCalledWith('Simple task', {
        projectId: null,
        dueAt: null,
      });
    });

    it('uses empty string when title is missing', async () => {
      const store = makeMockStore();
      const action = makeAction('create_task', {});

      await executeAction(action, {}, store);

      expect(store.addTask).toHaveBeenCalledWith('', {
        projectId: null,
        dueAt: null,
      });
    });
  });

  describe('update_task', () => {
    it('updates task with provided params', async () => {
      const store = makeMockStore();
      const action = makeAction('update_task', { title: 'Updated', priority: 'high' });
      const context = { taskId: 7 };

      await executeAction(action, context, store);

      expect(store.updateTask).toHaveBeenCalledWith(7, {
        title: 'Updated',
        priority: 'high',
      });
    });

    it('does nothing when taskId is missing from context', async () => {
      const store = makeMockStore();
      const action = makeAction('update_task', { title: 'Nope' });
      const context = {};

      await executeAction(action, context, store);

      expect(store.updateTask).not.toHaveBeenCalled();
    });

    it('does nothing when taskId is undefined in context', async () => {
      const store = makeMockStore();
      const action = makeAction('update_task', { title: 'Nope' });
      const context = { taskId: undefined };

      await executeAction(action, context, store);

      expect(store.updateTask).not.toHaveBeenCalled();
    });
  });

  describe('send_notification', () => {
    it('calls createNotification with title and body', async () => {
      const store = makeMockStore();
      const action = makeAction('send_notification', {
        title: 'Reminder',
        body: 'Time to focus!',
      });

      await executeAction(action, {}, store);

      expect(createNotification).toHaveBeenCalledWith('ai', 'Reminder', 'Time to focus!');
    });

    it('defaults title to "AI" and body to empty string', async () => {
      const store = makeMockStore();
      const action = makeAction('send_notification', {});

      await executeAction(action, {}, store);

      expect(createNotification).toHaveBeenCalledWith('ai', 'AI', '');
    });
  });

  describe('unknown action type', () => {
    it('logs warning and does not throw', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const store = makeMockStore();
      const action = makeAction('nonexistent_action', { foo: 'bar' });

      await expect(executeAction(action, {}, store)).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith('[ai] unknown action type: nonexistent_action');
      warnSpy.mockRestore();
    });

    it('does not call any store methods for unknown action', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const store = makeMockStore();
      const action = makeAction('bogus', {});

      await executeAction(action, {}, store);

      expect(store.addTask).not.toHaveBeenCalled();
      expect(store.updateTask).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    });
  });
});
