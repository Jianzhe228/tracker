/**
 * Sibling retriever — retrieves subtask suggestions from sibling tasks
 * in the same project (excluding the target task itself).
 */
import type { SuggestionCandidate } from '../../../types/domain';
import { useTaskStore } from '../../../stores/taskStore';

export async function retrieveSiblingCandidates(
  projectId: number | null,
  excludeTaskId?: number,
  keywords: string[] = [],
  limit = 8,
): Promise<SuggestionCandidate[]> {
  if (projectId === null || keywords.length === 0) return [];

  try {
    const taskStore = useTaskStore();
    const keywordsLower = keywords.map((keyword) => keyword.toLowerCase());
    const byId = new Map(taskStore.tasks.map((task) => [task.id, task]));
    const siblings = taskStore.tasks
      .filter((task) => {
        if (task.parentId == null) return false;
        if (task.id === excludeTaskId || task.parentId === excludeTaskId) return false;
        if (task.projectId !== projectId) return false;
        if (task.status === 'done' || task.status === 'cancelled') return false;

        const parentTask = byId.get(task.parentId);
        if (!parentTask) return false;

        const parentTitle = parentTask.title.toLowerCase();
        return keywordsLower.some((keyword) =>
          parentTitle.includes(keyword) || keyword.includes(parentTitle),
        );
      })
      .slice(0, limit)
      .map((task) => task.title);

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
