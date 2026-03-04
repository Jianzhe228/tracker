/**
 * Learning engine — suggests subtasks based on user behavior history.
 * Queries the subtask_learn_log table via Rust backend.
 */
import type { LearnSuggestion } from '../../types/domain';
import { learnSuggest, learnRecordBatch } from '../commands/learning';

const isTauri = '__TAURI_INTERNALS__' in window;

const MIN_SUGGESTIONS = 2;

export interface LearnResult {
  suggestions: string[];
  raw: LearnSuggestion[];
}

/**
 * Get learned subtask suggestions for the given keywords and project.
 * Returns null if insufficient data (< MIN_SUGGESTIONS).
 */
export async function suggestFromLearning(
  keywords: string[],
  projectId: number | null,
  limit?: number,
): Promise<LearnResult | null> {
  if (!isTauri || keywords.length === 0) return null;

  try {
    const results = await learnSuggest(keywords, projectId, limit ?? 8);
    if (results.length < MIN_SUGGESTIONS) return null;

    return {
      suggestions: results.map((r) => r.title),
      raw: results,
    };
  } catch (e) {
    console.error('[learning-engine] suggest failed', e);
    return null;
  }
}

/**
 * Record that a user adopted (delta=+1) or rejected (delta=-1) a subtask suggestion.
 * Records against all extracted keywords for the parent task.
 */
export async function recordFeedback(
  keywords: string[],
  subtaskTitle: string,
  projectId: number | null,
  adopted: boolean,
  source?: string,
): Promise<void> {
  if (!isTauri || keywords.length === 0) return;

  try {
    await learnRecordBatch(
      keywords,
      subtaskTitle,
      projectId,
      adopted ? 1 : -1,
      source,
    );
  } catch (e) {
    console.error('[learning-engine] record feedback failed', e);
  }
}
