/**
 * Pattern matcher — matches task keywords against the pattern template library.
 */
import type { SubtaskPattern } from '../../types/domain';
import { patternMatch } from '../commands/pattern';

const isTauri = '__TAURI_INTERNALS__' in window;

export interface PatternMatchResult {
  pattern: SubtaskPattern;
  subtasks: string[];
}

/**
 * Match keywords against the pattern library via Rust backend.
 * Falls back to empty result in web-only mode.
 */
export async function matchPatterns(
  keywords: string[],
  projectId: number | null,
): Promise<PatternMatchResult | null> {
  if (!isTauri || keywords.length === 0) return null;

  try {
    const matched = await patternMatch(keywords, projectId);
    if (matched.length === 0) return null;

    // Return the top match (highest usage_count, project-specific first)
    const best = matched[0];
    return {
      pattern: best,
      subtasks: best.subtasks,
    };
  } catch (e) {
    console.error('[pattern-matcher] match failed', e);
    return null;
  }
}
