/**
 * Learning retriever — retrieves subtask suggestions from the learn log.
 */
import type { SuggestionCandidate } from '../../../types/domain';
import { learnSuggest } from '../../commands/learning';

const isTauri = '__TAURI_INTERNALS__' in window;

export async function retrieveLearningCandidates(
  keywords: string[],
  projectId: number | null,
  limit = 8,
): Promise<SuggestionCandidate[]> {
  if (!isTauri || keywords.length === 0) return [];

  try {
    const results = await learnSuggest(keywords, projectId, limit);
    if (!results || results.length === 0) return [];

    return results.map(r => ({
      title: r.title,
      sources: ['learning'] as const,
      evidence: [
        `learn_score: ${r.score}`,
        `last_used: ${r.lastUsedAt}`,
      ],
      rawScore: r.score,
    }));
  } catch (e) {
    console.error('[retriever/learning] failed to retrieve candidates', e);
    return [];
  }
}
