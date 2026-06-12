import { useTaskStore } from '../stores/taskStore';
import { useTimerStore } from '../stores/timerStore';
import { useUiStore } from '../stores/uiStore';
import { playTone } from '../services/sound';

type ConfirmFn = (message: string) => Promise<boolean>;

/**
 * Shared task completion flow for every surface that toggles a task
 * (task list, detail panel, focus modal). Keeps error notices, the
 * completion tone, timer detachment and the "complete parent too?"
 * prompt in one place so the surfaces can't drift apart.
 *
 * `confirm` controls how the parent prompt is presented — inline bar
 * in TasksView, dialog in FocusModal.
 */
export function useTaskToggle() {
  const taskStore = useTaskStore();
  const timerStore = useTimerStore();
  const uiStore = useUiStore();

  function detachTimerIfCurrent(taskId: number): void {
    // The running session must stop attributing time to a done task
    if (taskId === timerStore.currentTaskId) {
      timerStore.clearTask();
    }
  }

  async function toggleTaskWithFlow(taskId: number, confirm: ConfirmFn): Promise<void> {
    const result = await taskStore.toggleTask(taskId);
    if (!result.ok) {
      if (result.reason === 'has_incomplete_subtasks') {
        uiStore.notify('请先完成所有子任务，再完成父任务');
      } else if (result.reason === 'sync_failed') {
        uiStore.notify('更新任务状态失败，请重试');
      }
      return;
    }

    const toggled = taskStore.tasks.find((task) => task.id === taskId);
    if (toggled?.status === 'done') {
      playTone('taskDone');
      detachTimerIfCurrent(taskId);
    }

    if (!result.shouldPromptCompleteParent || result.parentId == null) return;

    const parentTask = taskStore.tasks.find((task) => task.id === result.parentId);
    if (!parentTask || parentTask.status === 'done') return;

    const shouldCompleteParent = await confirm(`子任务已全部完成，是否同时完成父任务「${parentTask.title}」？`);
    if (!shouldCompleteParent) return;

    const parentResult = await taskStore.toggleTask(parentTask.id);
    if (!parentResult.ok) {
      if (parentResult.reason === 'has_incomplete_subtasks') {
        uiStore.notify('父任务仍有未完成子任务，请检查后再试');
      } else if (parentResult.reason === 'sync_failed') {
        uiStore.notify('更新父任务状态失败，请重试');
      }
      return;
    }

    playTone('taskDone');
    detachTimerIfCurrent(parentTask.id);
  }

  return { toggleTaskWithFlow };
}
