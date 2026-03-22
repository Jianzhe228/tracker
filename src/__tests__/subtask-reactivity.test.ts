/**
 * Tests for subtask reactivity: when a subtask is created via addTask,
 * computed properties that filter by parentId must update immediately.
 *
 * This reproduces the bug where the sidebar subtask list doesn't refresh
 * after accepting a suggestion (which creates a subtask via addTask).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { computed, nextTick } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import { useTaskStore } from '../stores/taskStore';

// The app checks for __TAURI_INTERNALS__ — ensure we're in non-Tauri mode
// so addTask uses the local (non-invoke) code path.
delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;

describe('taskStore subtask reactivity', () => {
  let store: ReturnType<typeof useTaskStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useTaskStore();
  });

  it('computed subtask list updates after addTask with parentId', async () => {
    // 1. Create a parent task
    const parent = await store.addTask('Parent Task');

    // 2. Set up a computed that filters subtasks — mirrors selectedTaskSubtasks in TasksView
    const subtasks = computed(() =>
      store.tasks.filter((t) => t.parentId === parent.id)
    );

    expect(subtasks.value).toHaveLength(0);

    // 3. Create a subtask (simulates acceptSuggestion → addTask)
    const child = await store.addTask('Child Task', { parentId: parent.id });

    // 4. The computed MUST reflect the new subtask immediately (no nextTick needed)
    expect(subtasks.value).toHaveLength(1);
    expect(subtasks.value[0].id).toBe(child.id);
    expect(subtasks.value[0].title).toBe('Child Task');
    expect(subtasks.value[0].parentId).toBe(parent.id);
  });

  it('computed updates after multiple subtasks added sequentially', async () => {
    const parent = await store.addTask('Parent');
    const subtasks = computed(() =>
      store.tasks.filter((t) => t.parentId === parent.id)
    );

    await store.addTask('Sub 1', { parentId: parent.id });
    expect(subtasks.value).toHaveLength(1);

    await store.addTask('Sub 2', { parentId: parent.id });
    expect(subtasks.value).toHaveLength(2);

    await store.addTask('Sub 3', { parentId: parent.id });
    expect(subtasks.value).toHaveLength(3);
  });

  it('computed updates after nextTick when synchronous check fails', async () => {
    // This test verifies the fallback: even if synchronous check somehow fails,
    // nextTick must trigger the update.
    const parent = await store.addTask('Parent');
    const subtasks = computed(() =>
      store.tasks.filter((t) => t.parentId === parent.id)
    );

    await store.addTask('Subtask', { parentId: parent.id });
    await nextTick();

    expect(subtasks.value).toHaveLength(1);
  });

  it('tasks array identity changes after addTask', async () => {
    // The key to reactivity: tasks.value must be a NEW array reference
    const before = store.tasks;

    await store.addTask('New Task');

    const after = store.tasks;
    expect(before).not.toBe(after); // Must be a different array reference
  });

  it('todoCount computed updates when tasks change', async () => {
    expect(store.todoCount).toBe(0);

    await store.addTask('Task 1');
    expect(store.todoCount).toBe(1);

    await store.addTask('Task 2');
    expect(store.todoCount).toBe(2);
  });
});
