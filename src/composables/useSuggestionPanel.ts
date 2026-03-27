/**
 * Composable: suggestion panel state for task detail sidebar.
 *
 * Manages per-task suggestion state (keyed by taskId), triggers the
 * suggestion pipeline, and handles accept/reject with feedback recording.
 */
import { shallowRef, triggerRef, reactive, type ShallowRef } from 'vue';
import { suggest, buildAiContext, extractKeywords, recordFeedback } from '../services/suggestion';
import { enqueue } from '../services/ai/queue';
import { feedbackRecord } from '../services/commands/learning';
import { updateAiJob } from '../services/commands/ai';
import { refreshKnownKeywords } from '../services/suggestion/keywordCache';
import { useTaskStore } from '../stores/taskStore';
import { useSettingsStore } from '../stores/settingsStore';

export type SuggestionSource = 'pattern' | 'learning' | 'ai';

/**
 * Normalize a suggestion title for semantic deduplication.
 * Strips common action prefixes like "带", "准备", "购买", etc.
 * so that "带衣服" and "衣服" are treated as duplicates.
 */
/**
 * Normalize a suggestion title for semantic deduplication.
 * Checks if titles are substrings of each other (e.g., "衣服" ⊆ "带衣服").
 * Returns the shorter title if they're substrings, otherwise empty.
 */
function normalizeForDedup(title: string): string {
  return title.toLowerCase().trim();
}

/**
 * Check if two titles are semantically duplicate (one is substring of other).
 */
function isSemanticDuplicate(a: string, b: string): boolean {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length < 2) return false;
  return longer.includes(shorter);
}

export interface SidebarSuggestion {
  title: string;
  source: SuggestionSource;
  patternName?: string;
}

export interface SuggestionPanelState {
  suggestions: SidebarSuggestion[];
  keywords: string[];
  loading: boolean;
  collapsed: boolean;
  requested: boolean;  // true once user/system triggered suggestions
}

function emptyState(): SuggestionPanelState {
  return reactive({ suggestions: [], keywords: [], loading: false, collapsed: false, requested: false });
}

export function useSuggestionPanel() {
  const panels: ShallowRef<Map<number, SuggestionPanelState>> = shallowRef(new Map());

  function notify(): void {
    triggerRef(panels);
  }

  function getPanel(taskId: number): SuggestionPanelState | undefined {
    return panels.value.get(taskId);
  }

  /**
   * Run the full suggestion pipeline for a task.
   * Local results appear instantly; AI results append when ready.
   */
  async function requestSuggestions(
    taskId: number,
    taskTitle: string,
    projectId: number | null,
  ): Promise<void> {
    // Init or reset panel
    const state = emptyState();
    state.requested = true;
    state.loading = true;
    panels.value.set(taskId, state);
    notify();

    try {
      // Collect existing subtask titles to avoid duplicates
      const taskStore = useTaskStore();
      const existingSubtaskTitles = new Set(
        taskStore.tasks
          .filter((t) => t.parentId === taskId)
          .map((t) => t.title)
      );

      // 1. Run local pipeline
      const output = await suggest({ taskTitle, projectId });
      state.keywords = output.keywords;

      if (output.result.suggestions.length > 0) {
        state.suggestions = output.result.suggestions
          .filter((s) => !existingSubtaskTitles.has(s))
          .map((s) => ({
            title: s,
            source: output.result.source as SuggestionSource,
            patternName: output.result.patternName,
          }));
        notify();
      }

      // 2. Fire AI if strategy requires it
      if (output.strategy !== 'local') {
        const settingsStore = useSettingsStore();
        if (settingsStore.ai.endpoint && settingsStore.ai.apiKey) {
          try {
            const aiContext = await buildAiContext({ taskTitle, projectId });
            const project = taskStore.projects?.find((p: { id: number }) => p.id === projectId);

            const job = await enqueue('task_decompose', {
              taskId,
              taskTitle,
              projectName: project?.title ?? '',
              userPatterns: aiContext.userPatterns,
              learnedItems: aiContext.learnedItems,
              rejectedItems: aiContext.rejectedItems,
              manualSubtasks: aiContext.manualSubtasks,
              siblingTasks: aiContext.siblingTasks,
            });

            if (job?.actions?.length) {
              // Refresh subtask titles (some may have been created while AI was running)
              const currentSubtaskTitles = new Set(
                taskStore.tasks.filter((t) => t.parentId === taskId).map((t) => t.title)
              );
              // Build set of existing titles for exact-match deduplication
              const existingTitles = new Set([
                ...currentSubtaskTitles,
                ...state.suggestions.map((s) => s.title),
              ]);
              for (const action of job.actions) {
                if (
                  action.type === 'create_subtask' &&
                  action.params.title
                ) {
                  const title = String(action.params.title);
                  // Skip if exact match already exists
                  if (existingTitles.has(title)) continue;
                  // Skip if semantically duplicate (e.g., "衣服" in "带衣服")
                  const isDup = [...existingTitles].some(
                    (existing) => isSemanticDuplicate(normalizeForDedup(existing), normalizeForDedup(title))
                  );
                  if (!isDup) {
                    state.suggestions.push({
                      title,
                      source: 'ai',
                    });
                    existingTitles.add(title); // prevent duplicates within AI batch too
                  }
                }
                // Mark action so it doesn't appear in NotificationCenter
                action.status = 'executed';
              }
              // Persist the status change to DB
              updateAiJob(job.id, { actions: job.actions }).catch((e) => {
                console.warn('[suggestion-panel] failed to persist AI job status', e);
              });
            }
          } catch (e) {
            console.error('[suggestion-panel] AI job failed', e);
          }
        }
      }
    } catch (e) {
      console.error('[suggestion-panel] suggestion pipeline failed', e);
    } finally {
      state.loading = false;
      notify();
    }
  }

  /**
   * Accept a single suggestion — create subtask + record positive feedback.
   */
  async function acceptSuggestion(
    taskId: number,
    suggestion: SidebarSuggestion,
  ): Promise<void> {
    const taskStore = useTaskStore();
    const parentTask = taskStore.tasks.find((t) => t.id === taskId);
    if (!parentTask) return;

    const panel = panels.value.get(taskId);
    if (!panel) return;

    try {
      await taskStore.addTask(suggestion.title, {
        parentId: parentTask.id,
        projectId: parentTask.projectId,
        dueAt: parentTask.dueAt,
      });

      // Record positive feedback (single path — learning engine + feedback table)
      recordFeedback(
        panel.keywords,
        suggestion.title,
        parentTask.projectId,
        true,
        suggestion.source,
      );

      if (suggestion.source === 'ai') {
        feedbackRecord({
          taskId,
          taskTitle: parentTask.title,
          projectId: parentTask.projectId,
          suggestionTitle: suggestion.title,
          source: 'ai',
          action: 'accepted',
          jobId: null,
        }).catch((e) => {
          console.warn('[suggestion-panel] failed to record feedback', e);
        });
        refreshKnownKeywords().catch((e) => {
          console.warn('[suggestion-panel] failed to refresh keywords', e);
        });
      }

      // Remove from list
      removeSuggestion(taskId, suggestion.title);
    } catch (e) {
      console.error('[suggestion-panel] accept failed', e);
    }
  }

  /**
   * Reject a single suggestion — record negative feedback.
   */
  function rejectSuggestion(
    taskId: number,
    suggestion: SidebarSuggestion,
  ): void {
    const taskStore = useTaskStore();
    const parentTask = taskStore.tasks.find((t) => t.id === taskId);
    const panel = panels.value.get(taskId);
    if (!panel) return;

    recordFeedback(
      panel.keywords,
      suggestion.title,
      parentTask?.projectId ?? null,
      false,
      suggestion.source,
    );

    if (suggestion.source === 'ai' && parentTask) {
      feedbackRecord({
        taskId,
        taskTitle: parentTask.title,
        projectId: parentTask.projectId,
        suggestionTitle: suggestion.title,
        source: 'ai',
        action: 'rejected',
        jobId: null,
      }).catch((e) => {
        console.warn('[suggestion-panel] failed to record rejection', e);
      });
    }

    removeSuggestion(taskId, suggestion.title);
  }

  /**
   * Accept all remaining suggestions at once.
   */
  async function acceptAll(taskId: number): Promise<void> {
    const panel = panels.value.get(taskId);
    if (!panel) return;

    // Copy the list because it mutates during accept
    const items = [...panel.suggestions];
    await Promise.all(items.map((item) => acceptSuggestion(taskId, item)));
  }

  /**
   * Dismiss/collapse the panel for a task.
   */
  function dismissPanel(taskId: number): void {
    const panel = panels.value.get(taskId);
    if (panel) {
      panel.collapsed = true;
      notify();
    }
  }

  /**
   * Toggle collapsed state.
   */
  function toggleCollapsed(taskId: number): void {
    const panel = panels.value.get(taskId);
    if (panel) {
      panel.collapsed = !panel.collapsed;
      notify();
    }
  }

  function removeSuggestion(taskId: number, title: string): void {
    const panel = panels.value.get(taskId);
    if (!panel) return;
    panel.suggestions = panel.suggestions.filter((s) => s.title !== title);
    notify();
  }

  /**
   * Remove a panel completely (for cleanup on unmount).
   */
  function removePanel(taskId: number): void {
    panels.value.delete(taskId);
    notify();
  }

  /**
   * Clear all panels (for unmount cleanup).
   */
  function clearAllPanels(): void {
    panels.value.clear();
    notify();
  }

  return {
    panels,
    getPanel,
    requestSuggestions,
    acceptSuggestion,
    rejectSuggestion,
    acceptAll,
    dismissPanel,
    toggleCollapsed,
    removePanel,
    clearAllPanels,
  };
}
