/**
 * Tests for taskStore history-driven nested autofill on task creation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

Object.defineProperty(window, '__TAURI_INTERNALS__', {
  value: {},
  configurable: true,
});

let nextId = 100;

vi.mock('../services/commands/task', () => ({
  listTasks: vi.fn(() => Promise.resolve([])),
  listWorkingSet: vi.fn(() => Promise.resolve([])),
  listArchive: vi.fn(() => Promise.resolve({ tasks: [], nextCursor: null, exhausted: true })),
  taskStatusCounts: vi.fn(() => Promise.resolve({
    todo: 0, done: 0, cancelled: 0, total: 0,
    rootTodo: 0, rootDone: 0, rootCancelled: 0, rootTotal: 0,
  })),
  createTask: vi.fn(async (task: Record<string, unknown>) => ({
    ...task,
    id: nextId++,
  })),
  updateTask: vi.fn(() => Promise.resolve()),
  deleteTask: vi.fn(() => Promise.resolve()),
  restoreTask: vi.fn(() => Promise.resolve()),
}));

vi.mock('../services/commands/prediction', () => ({
  recordTaskCreation: vi.fn(() => Promise.resolve()),
}));

vi.mock('../services/commands/learning', () => ({
  historyGetTemplate: vi.fn(() => Promise.resolve([])),
}));

describe('taskStore history autofill', () => {
  beforeEach(() => {
    nextId = 100;
    vi.clearAllMocks();
    vi.resetModules();
    setActivePinia(createPinia());
  });

  it('creates a nested history template tree after creating a matching task', async () => {
    const { useTaskStore } = await import('../stores/taskStore');
    const store = useTaskStore();
    const { historyGetTemplate } = await import('../services/commands/learning');

    vi.mocked(historyGetTemplate).mockResolvedValueOnce([
      {
        title: '完成一套模拟试题',
        children: [
          { title: '写三篇阅读', children: [] },
          { title: '一篇翻译', children: [] },
          { title: '一篇写作', children: [] },
        ],
      },
    ]);

    const root = await store.addTask('四六级学习', { projectId: 1 });

    const mockExam = store.tasks.find(
      (task) => task.parentId === root.id && task.title === '完成一套模拟试题',
    );

    expect(mockExam).toBeDefined();
    expect(
      store.tasks
        .filter((task) => task.parentId === mockExam?.id)
        .map((task) => task.title)
        .sort(),
    ).toEqual(['一篇写作', '一篇翻译', '写三篇阅读'].sort());
    expect(store.consumeHistoryAutofill(root.id)).toBe(true);
  });

  it('continues autofilling one more level for history-created subtasks', async () => {
    const { useTaskStore } = await import('../stores/taskStore');
    const store = useTaskStore();
    const { historyGetTemplate } = await import('../services/commands/learning');

    vi.mocked(historyGetTemplate)
      .mockResolvedValueOnce([
        {
          title: '完成一套模拟试题',
          children: [],
        },
      ])
      .mockResolvedValueOnce([
        { title: '写三篇阅读', children: [] },
        { title: '一篇翻译', children: [] },
        { title: '一篇写作', children: [] },
      ]);

    const root = await store.addTask('四六级学习', { projectId: 1 });
    const mockExam = store.tasks.find(
      (task) => task.parentId === root.id && task.title === '完成一套模拟试题',
    );

    expect(mockExam).toBeDefined();
    expect(
      store.tasks
        .filter((task) => task.parentId === mockExam?.id)
        .map((task) => task.title)
        .sort(),
    ).toEqual(['一篇写作', '一篇翻译', '写三篇阅读'].sort());
  });

  it('does not mark autofill when no history template exists', async () => {
    const { useTaskStore } = await import('../stores/taskStore');
    const store = useTaskStore();
    const { historyGetTemplate } = await import('../services/commands/learning');

    vi.mocked(historyGetTemplate).mockResolvedValueOnce([]);

    const root = await store.addTask('全新任务', { projectId: 1 });

    expect(historyGetTemplate).toHaveBeenCalled();
    expect(store.consumeHistoryAutofill(root.id)).toBe(false);
  });

  it('does not query history templates when creating a nested subtask', async () => {
    const { useTaskStore } = await import('../stores/taskStore');
    const store = useTaskStore();
    const { historyGetTemplate } = await import('../services/commands/learning');

    const parent = await store.addTask('旅游计划', { projectId: 1 });
    vi.clearAllMocks();

    await store.addTask('订酒店', { parentId: parent.id, projectId: 1 });

    expect(historyGetTemplate).not.toHaveBeenCalled();
  });
});
