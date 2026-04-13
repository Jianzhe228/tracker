/**
 * History retriever — retrieves subtask suggestions from task_subtask_history.
 */
import type { SuggestionCandidate } from '../../../types/domain';
import { historyGetTemplate } from '../../commands/learning';

const isTauri = '__TAURI_INTERNALS__' in window;

export async function retrieveHistoryCandidates(
  taskTitle: string,
  keywords: string[],
  projectId: number | null,
): Promise<SuggestionCandidate[]> {
  if (!isTauri || keywords.length === 0) return [];

  try {
    const templates = await historyGetTemplate(taskTitle, keywords, projectId, 2);
    if (!templates || templates.length === 0) return [];

    return templates.map((template) => ({
      title: template.title,
      sources: ['history'] as const,
      evidence: ['from_task_subtask_history'],
      children: template.children,
    }));
  } catch (e) {
    console.error('[retriever/history] failed to retrieve candidates', e);
    return [];
  }
}
