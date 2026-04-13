/**
 * History retriever — retrieves subtask suggestions from task_subtask_history.
 */
import type { SuggestionCandidate } from '../../../types/domain';
import { historySuggest } from '../../commands/learning';

const isTauri = '__TAURI_INTERNALS__' in window;

export async function retrieveHistoryCandidates(
  keywords: string[],
  projectId: number | null,
  limit = 8,
): Promise<SuggestionCandidate[]> {
  if (!isTauri || keywords.length === 0) return [];

  try {
    const titles = await historySuggest(keywords, projectId, limit);
    if (!titles || titles.length === 0) return [];

    return titles.map(title => ({
      title,
      sources: ['history'] as const,
      evidence: ['from_task_subtask_history'],
    }));
  } catch (e) {
    console.error('[retriever/history] failed to retrieve candidates', e);
    return [];
  }
}
