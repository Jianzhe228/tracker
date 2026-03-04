/**
 * AI action executor — dispatches AiAction to store operations.
 */
import type { AiAction } from './types';
import { useTaskStore } from '../../stores/taskStore';
import { createNotification } from '../commands/notification';

type ActionHandler = (action: AiAction, context: Record<string, unknown>) => Promise<void>;

const handlers: Record<string, ActionHandler> = {
  async create_subtask(action, context) {
    const taskStore = useTaskStore();
    const parentId = context.taskId as number | undefined;
    const parentTask = parentId
      ? taskStore.tasks.find((t) => t.id === parentId)
      : undefined;

    await taskStore.addTask(String(action.params.title ?? ''), {
      parentId: parentId ?? null,
      projectId: parentTask?.projectId ?? null,
      dueAt: parentTask?.dueAt ?? null,
    });
  },

  async create_task(action) {
    const taskStore = useTaskStore();
    await taskStore.addTask(String(action.params.title ?? ''), {
      projectId: (action.params.projectId as number | undefined) ?? null,
      dueAt: (action.params.dueAt as string | undefined) ?? null,
    });
  },

  async update_task(action, context) {
    const taskStore = useTaskStore();
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

export async function executeAction(action: AiAction, context: Record<string, unknown>): Promise<void> {
  const handler = handlers[action.type];
  if (!handler) {
    console.warn(`[ai] unknown action type: ${action.type}`);
    return;
  }
  await handler(action, context);
}
