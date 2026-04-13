/**
 * Sibling retriever — retrieves subtask suggestions from sibling tasks
 * in the same project (excluding the target task itself).
 */
import type { SuggestionCandidate } from '../../../types/domain';
import { useTaskStore } from '../../../stores/taskStore';

export async function retrieveSiblingCandidates(
  projectId: number | null,
  excludeTaskId?: number,
  limit = 8,
): Promise<SuggestionCandidate[]> {
  if (projectId === null) return [];

  try {
    const taskStore = useTaskStore();
    const siblings = taskStore.tasks
      .filter(t =>
        t.projectId === projectId &&
        t.id !== excludeTaskId &&
        t.status !== 'done' &&
        t.status !== 'cancelled',
      )
      .slice(0, limit)
      .map(t => t.title);

    return siblings.map(title => ({
      title,
      sources: ['sibling'] as const,
      evidence: ['from_sibling_tasks'],
    }));
  } catch (e) {
    console.error('[retriever/sibling] failed to retrieve candidates', e);
    return [];
  }
}
