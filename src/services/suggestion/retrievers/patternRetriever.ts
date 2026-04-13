/**
 * Pattern retriever — retrieves subtask suggestions from pattern templates.
 */
import type { SuggestionCandidate } from '../../../types/domain';
import { patternMatch } from '../../commands/pattern';

const isTauri = '__TAURI_INTERNALS__' in window;

export async function retrievePatternCandidates(
  keywords: string[],
  projectId: number | null,
): Promise<SuggestionCandidate[]> {
  if (!isTauri || keywords.length === 0) return [];

  try {
    const patterns = await patternMatch(keywords, projectId);
    if (!patterns || patterns.length === 0) return [];

    const candidates: SuggestionCandidate[] = [];
    for (const pattern of patterns) {
      for (const subtask of pattern.subtasks) {
        candidates.push({
          title: subtask,
          sources: ['pattern'],
          evidence: [
            `pattern: ${pattern.name}`,
            `matched_keywords: ${keywords.join(', ')}`,
          ],
          rawScore: pattern.usageCount,
        });
      }
    }
    return candidates;
  } catch (e) {
    console.error('[retriever/pattern] failed to retrieve candidates', e);
    return [];
  }
}
