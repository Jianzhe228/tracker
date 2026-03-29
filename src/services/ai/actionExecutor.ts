/**
 * AI action executor — dispatches AiAction to store operations.
 * Accepts a TaskStore-like interface to avoid direct store dependency.
 */
import type { AiAction } from './types';
import { isSemanticDuplicateTitle } from './subtaskDedup';
import { createNotification } from '../commands/notification';

export interface ActionExecutorTaskStore {
  tasks: Array<{ id: number; title: string; parentId: number | null; projectId: number | null; dueAt: string | null }>;
  addTask: (title: string, opts: { parentId?: number | null; projectId?: number | null; dueAt?: string | null }) => Promise<unknown>;
  updateTask: (id: number, data: Record<string, unknown>) => Promise<void>;
}

type ActionHandler = (action: AiAction, context: Record<string, unknown>, taskStore: ActionExecutorTaskStore) => Promise<void>;

const handlers: Record<string, ActionHandler> = {
  async create_subtask(action, context, taskStore) {
    const parentId = context.taskId as number | undefined;
    const title = String(action.params.title ?? '');
    const parentTask = parentId
      ? taskStore.tasks.find((t) => t.id === parentId)
      : undefined;

    if (parentId) {
      const hasDuplicate = taskStore.tasks.some((task) =>
        task.parentId === parentId && isSemanticDuplicateTitle(task.title, title)
      );
      if (hasDuplicate) return;
    }

    await taskStore.addTask(title, {
      parentId: parentId ?? null,
      projectId: parentTask?.projectId ?? null,
      dueAt: parentTask?.dueAt ?? null,
    });
  },

  async create_task(action, _context, taskStore) {
    await taskStore.addTask(String(action.params.title ?? ''), {
      projectId: (action.params.projectId as number | undefined) ?? null,
      dueAt: (action.params.dueAt as string | undefined) ?? null,
    });
  },

  async update_task(action, context, taskStore) {
    const taskId = context.taskId as number | undefined;
    if (!taskId) return;
    await taskStore.updateTask(taskId, action.params);
  },

  async send_notification(action) {
    const title = String(action.params.title ?? 'AI');
    const body = String(action.params.body ?? '');
    await createNotification('ai', title, body);
  },
};

export async function executeAction(
  action: AiAction,
  context: Record<string, unknown>,
  taskStore?: ActionExecutorTaskStore,
): Promise<void> {
  const handler = handlers[action.type];
  if (!handler) {
    console.warn(`[ai] unknown action type: ${action.type}`);
    return;
  }
  // Lazy-load store only if not provided (backward compat)
  const store = taskStore ?? (await import('../../stores/taskStore')).useTaskStore();
  await handler(action, context, store);
}
