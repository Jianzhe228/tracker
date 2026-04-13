/**
 * Composable: suggestion panel state for task detail sidebar.
 *
 * Manages per-task suggestion state (keyed by taskId), triggers the
 * suggestion pipeline via the Phase 1 harness, and handles accept/reject
 * with feedback recording and trace persistence.
 */
import { shallowRef, triggerRef, reactive, type ShallowRef } from 'vue';
import { runHarness, toSidebarSuggestions } from '../services/suggestion/suggestionHarness';
import { buildAiContextFromAnalysis } from '../services/suggestion/suggestionHarness';
import { extractKeywords } from '../services/suggestion/keywordExtractor';
import { recordFeedback } from '../services/suggestion/learningEngine';
import { enqueue } from '../services/ai/queue';
import { feedbackRecord } from '../services/commands/learning';
import { updateAiJob } from '../services/commands/ai';
import { isSemanticDuplicateTitle } from '../services/ai/subtaskDedup';
import { refreshKnownKeywords } from '../services/suggestion/keywordCache';
import { useTaskStore } from '../stores/taskStore';
import { useSettingsStore } from '../stores/settingsStore';
import {
  suggestionRunCreate,
  suggestionCandidateInsert,
  suggestionCandidateMarkSelected,
  suggestionCandidateMarkRejected,
} from '../services/commands/suggestionTrace';
import { patternIncrementUsage } from '../services/commands/pattern';
import type { RankedSuggestion, TitleAnalysis } from '../types/domain';

export type SuggestionSource = 'pattern' | 'learning' | 'ai' | 'history' | 'sibling' | 'ai_generated';

export interface SidebarSuggestion {
  title: string;
  source: SuggestionSource;
  patternName?: string;
  candidateId?: number; // set after trace is persisted
}

export interface SuggestionPanelState {
  suggestions: SidebarSuggestion[];
  keywords: string[];
  loading: boolean;
  collapsed: boolean;
  requested: boolean;  // true once user/system triggered suggestions
  runId?: number;     // suggestion_runs.id after trace is persisted
  rankedSuggestions: RankedSuggestion[]; // full ranked data for trace
}

function emptyState(): SuggestionPanelState {
  return reactive({ suggestions: [], keywords: [], loading: false, collapsed: false, requested: false, rankedSuggestions: [] });
}

export function useSuggestionPanel() {
  const panels: ShallowRef<Map<number, SuggestionPanelState>> = shallowRef(new Map());

  function notify(): void {
    triggerRef(panels);
  }

  function getPanel(taskId: number): SuggestionPanelState | undefined {
    return panels.value.get(taskId);
  }

  async function persistTrace(
    state: SuggestionPanelState,
    taskId: number,
    taskTitle: string,
    projectId: number | null,
    analysis: TitleAnalysis,
    ranked: RankedSuggestion[],
    strategy: string,
    baseSuggestions: SidebarSuggestion[],
  ): Promise<void> {
    if (ranked.length === 0) return;

    try {
      const runId = await suggestionRunCreate({
        taskId,
        taskTitle,
        projectId,
        analysisJson: JSON.stringify(analysis),
        strategy,
      });
      state.runId = runId;

      const titleToCandidateId = new Map<string, number>();
      for (let i = 0; i < ranked.length; i++) {
        const candidate = ranked[i];
        const candidateId = await suggestionCandidateInsert({
          runId,
          title: candidate.title,
          source: candidate.sources[0] ?? 'learning',
          mergedSourcesJson: JSON.stringify(candidate.sources),
          score: candidate.score,
          evidenceJson: JSON.stringify(candidate.evidence),
          reasonsJson: JSON.stringify(candidate.reasons),
          shownRank: i + 1,
        });
        titleToCandidateId.set(candidate.title, candidateId);
      }

      state.suggestions = state.suggestions.map((suggestion) => {
        const fallback = baseSuggestions.find((item) => item.title === suggestion.title);
        return {
          ...suggestion,
          patternName: suggestion.patternName ?? fallback?.patternName,
          candidateId: titleToCandidateId.get(suggestion.title) ?? suggestion.candidateId,
        };
      });
      notify();
    } catch (e) {
      console.warn('[suggestion-panel] failed to persist trace', e);
    }
  }

  /**
   * Run the full suggestion harness for a task.
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
          .map((t) => t.title),
      );

      // Run the harness (all retrievers in parallel, then merge + rank)
      const output = await runHarness({
        taskId,
        taskTitle,
        projectId,
        existingSubtaskTitles,
      });

      state.keywords = output.analysis.keywords;
      state.rankedSuggestions = output.ranked;
      const initialSuggestions = toSidebarSuggestions(output.ranked);
      state.suggestions = initialSuggestions;

      notify();

      void persistTrace(
        state,
        taskId,
        taskTitle,
        projectId,
        output.analysis,
        output.ranked,
        output.strategy,
        initialSuggestions,
      );

      // Fire AI if strategy requires it
      if (output.strategy !== 'local') {
        const settingsStore = useSettingsStore();
        if (settingsStore.ai.endpoint && settingsStore.ai.apiKey) {
          try {
            const project = taskStore.projects?.find((p: { id: number }) => p.id === projectId);
            const aiContext = await buildAiContextFromAnalysis({
              taskId,
              taskTitle,
              projectId,
              projectName: project?.title ?? '',
              analysis: output.analysis,
              ranked: output.ranked,
              rejectedTitles: output.rejectedTitles,
            });

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
                  // Skip if semantically duplicate
                  const isDup = [...existingTitles].some(
                    (existing) => isSemanticDuplicateTitle(existing, title)
                  );
                  if (!isDup) {
                    state.suggestions.push({
                      title,
                      source: 'ai',
                    });
                    existingTitles.add(title);
                  }
                }
                action.status = 'executed';
              }
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
      console.error('[suggestion-panel] suggestion harness failed', e);
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

      // Record positive feedback to learning engine
      recordFeedback(
        panel.keywords,
        suggestion.title,
        parentTask.projectId,
        true,
        suggestion.source,
      );

      // Persist selection to trace
      if (suggestion.candidateId !== undefined) {
        suggestionCandidateMarkSelected(suggestion.candidateId).catch((e) => {
          console.warn('[suggestion-panel] failed to mark candidate selected', e);
        });
      }

      // Increment pattern usage if 'pattern' is among the candidate's sources
      // (for merged candidates, pattern may not be sources[0])
      const ranked = panel.rankedSuggestions.find(r => r.title === suggestion.title);
      const hasPatternSource = ranked?.sources.includes('pattern') ?? false;
      if (hasPatternSource && suggestion.patternName) {
        try {
          const { patternList } = await import('../services/commands/pattern');
          const patterns = await patternList(parentTask.projectId ?? undefined);
          const matched = patterns.find(p => p.name === suggestion.patternName);
          if (matched) {
            patternIncrementUsage(matched.id).catch((e) => {
              console.warn('[suggestion-panel] failed to increment pattern usage', e);
            });
          }
        } catch (e) {
          console.warn('[suggestion-panel] failed to find pattern for usage increment', e);
        }
      }

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

    // Persist rejection to trace
    if (suggestion.candidateId !== undefined) {
      suggestionCandidateMarkRejected(suggestion.candidateId).catch((e) => {
        console.warn('[suggestion-panel] failed to mark candidate rejected', e);
      });
    }

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

    const items = [...panel.suggestions];
    for (const item of items) {
      await acceptSuggestion(taskId, item);
    }
  }

  function dismissPanel(taskId: number): void {
    const panel = panels.value.get(taskId);
    if (panel) {
      panel.collapsed = true;
      notify();
    }
  }

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

  function removePanel(taskId: number): void {
    panels.value.delete(taskId);
    notify();
  }

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
